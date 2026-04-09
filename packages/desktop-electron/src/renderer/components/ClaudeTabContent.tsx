/**
 * Claude Tab Content Component
 *
 * Manages a single Claude Code CLI session: permissions prompt,
 * launch logic, exit detection, CWD change handling, and terminal display.
 * Extracted from the original ClaudePanel to support multi-tab sessions.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Terminal } from "./Terminal";
import { ClaudePermissionsPrompt } from "./ClaudePermissionsPrompt";
import { useSettings } from "../settings";
import { terminalEvents } from "../hooks/terminalEventStore";

/** Escape a path for safe shell usage (single-quote wrapping). */
function shellEscape(p: string): string {
  if (/[^a-zA-Z0-9_./-]/.test(p)) {
    return `'${p.replace(/'/g, "'\\''")}'`;
  }
  return p;
}

/** Extract a display-friendly directory name from a full path. */
function dirName(p: string): string {
  return p.split("/").pop() ?? p;
}

/** Shell process names — when Claude exits, the foreground process returns to one of these. */
const SHELL_NAMES = new Set([
  "bash", "zsh", "fish", "sh", "dash", "ksh", "tcsh", "csh",
  "-bash", "-zsh", "-fish", "-sh",
]);

export interface ClaudeTabContentProps {
  /** Terminal session ID — null before launch or after exit */
  sessionId: string | null;
  /** Called when a session is created or cleared */
  onSessionCreated: (sessionId: string | null) => void;
  /** Called when the session exits (user should close or recycle the tab) */
  onSessionExited: () => void;
  /** Panel width in pixels (for terminal column calculation) */
  width: number;
  /** Whether this tab is the active/visible one */
  isVisible: boolean;
  /** Function to get the CWD for launching Claude */
  getCwd: () => Promise<string | undefined>;
  /** Optional override CWD (e.g., worktree path) */
  overrideCwd?: string;
  /** Session ID of the terminal pane that was focused when the tab was created */
  focusedSessionId: string | null;
}

export function ClaudeTabContent({
  sessionId,
  onSessionCreated,
  onSessionExited,
  width,
  isVisible,
  getCwd,
  overrideCwd,
  focusedSessionId,
}: ClaudeTabContentProps) {
  const [launching, setLaunching] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  // Track the terminal session + CWD at launch time for directory change detection
  const [launchSessionId, setLaunchSessionId] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const launchGitRootRef = useRef<string | null>(null);
  // CWD change prompt: shown when the launch terminal's CWD changes
  const [cwdChangePrompt, setCwdChangePrompt] = useState<string | null>(null);
  const rememberRef = useRef(false);
  const { settings, updateSettings } = useSettings();

  // Listen for CWD changes in the launch terminal session
  useEffect(() => {
    if (!launchSessionId || !launchCwd || !sessionId) return;

    const cleanup = terminalEvents.subscribe('cwd-changed', (message: unknown) => {
      const msg = message as { sessionId?: string; cwd?: string };
      if (msg.sessionId !== launchSessionId) return;
      if (!msg.cwd || msg.cwd === launchCwd) return;

      // Don't prompt if the new CWD is still within the same git repo
      const gitRoot = launchGitRootRef.current;
      if (gitRoot && (msg.cwd === gitRoot || msg.cwd.startsWith(gitRoot + "/"))) return;

      setCwdChangePrompt(msg.cwd);
    });

    return cleanup;
  }, [launchSessionId, launchCwd, sessionId]);

  // When the IDE WebSocket disconnects (Claude CLI exited or crashed),
  // check if the foreground process has returned to the shell — if so, signal exit.
  useEffect(() => {
    if (!sessionId) return;

    const cleanup = window.terminalAPI.onIdeClientDisconnected(async () => {
      try {
        const result = await window.terminalAPI.getProcess(sessionId);
        if (!result.success || !result.process) return;

        const proc = result.process.split("/").pop() || result.process;
        if (SHELL_NAMES.has(proc)) {
          onSessionCreated(null);
          onSessionExited();
        }
      } catch {
        // Session already destroyed
      }
    });

    return cleanup;
  }, [sessionId, onSessionCreated, onSessionExited]);

  // Determine if we need the permissions prompt
  useEffect(() => {
    if (sessionId) return;
    if (launching) return;

    const claudeSettings = settings.claude;
    if (claudeSettings?.rememberChoice) {
      launchClaude(claudeSettings.dangerouslySkipPermissions);
    } else {
      setShowPrompt(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const launchClaude = useCallback(
    async (skipPermissions: boolean, cwdOverride?: string) => {
      setShowPrompt(false);
      setLaunching(true);
      setCwdChangePrompt(null);

      try {
        const cwd = cwdOverride ?? overrideCwd ?? (await getCwd());

        // Capture the launch context for directory change detection
        setLaunchSessionId(focusedSessionId);
        setLaunchCwd(cwd ?? null);
        if (cwd) {
          window.terminalAPI
            .getGitRoot(cwd)
            .then((r) => {
              launchGitRootRef.current = r.success && r.root ? r.root : null;
            })
            .catch(() => {
              launchGitRootRef.current = null;
            });
        } else {
          launchGitRootRef.current = null;
        }

        // Update IDE protocol lock file so Claude Code matches our workspace
        await window.terminalAPI.ideUpdateWorkspaceFolders(cwd);

        const result = await window.terminalAPI.createSession({
          cols: Math.floor(width / 9),
          rows: Math.floor(window.innerHeight / 17),
          cwd,
        });

        if (!result.success || !result.sessionId) {
          console.error("Failed to create Claude tab session:", result.error);
          setLaunching(false);
          return;
        }

        onSessionCreated(result.sessionId);

        setTimeout(() => {
          const flags = skipPermissions
            ? " --permission-mode bypassPermissions"
            : "";
          const cdPrefix = cwd ? `cd ${shellEscape(cwd)} && ` : "";
          window.terminalAPI.input(result.sessionId!, `${cdPrefix}claude${flags}\n`);
          setLaunching(false);
        }, 500);
      } catch (err) {
        console.error("Failed to launch Claude:", err);
        setLaunching(false);
      }
    },
    [width, getCwd, onSessionCreated, focusedSessionId, overrideCwd]
  );

  const handleChoice = useCallback(
    (skipPermissions: boolean) => {
      if (rememberRef.current) {
        updateSettings({
          claude: {
            dangerouslySkipPermissions: skipPermissions,
            rememberChoice: true,
          },
        });
      }
      launchClaude(skipPermissions);
    },
    [launchClaude, updateSettings]
  );

  const handleRememberChoice = useCallback((remember: boolean) => {
    rememberRef.current = remember;
  }, []);

  const handleSessionClose = useCallback(() => {
    onSessionCreated(null);
    onSessionExited();
  }, [onSessionCreated, onSessionExited]);

  const handleReopenInNewDir = useCallback(() => {
    const newCwd = cwdChangePrompt;
    if (!newCwd || !sessionId) return;

    window.terminalAPI.input(sessionId, "\x03");
    setTimeout(() => {
      window.terminalAPI.input(sessionId, "exit\n");
    }, 100);

    setCwdChangePrompt(null);
    onSessionCreated(null);

    const skipPerms = settings.claude?.dangerouslySkipPermissions ?? false;
    setTimeout(() => {
      launchClaude(skipPerms, newCwd);
    }, 600);
  }, [cwdChangePrompt, sessionId, onSessionCreated, settings.claude, launchClaude]);

  const handleDismissCwdChange = useCallback(() => {
    setCwdChangePrompt(null);
    if (cwdChangePrompt) setLaunchCwd(cwdChangePrompt);
    if (focusedSessionId) setLaunchSessionId(focusedSessionId);
  }, [cwdChangePrompt, focusedSessionId]);

  return (
    <div className="claude-panel-content" style={{ display: isVisible ? undefined : "none" }}>
      {showPrompt && !sessionId && !launching && (
        <ClaudePermissionsPrompt
          onChoice={handleChoice}
          onRememberChoice={handleRememberChoice}
        />
      )}
      {launching && !sessionId && (
        <div className="claude-panel-loading">Starting Claude Code...</div>
      )}
      {sessionId && (
        <div className="claude-panel-terminal">
          <Terminal
            sessionId={sessionId}
            isVisible={isVisible}
            isFocused={isVisible}
            onClose={handleSessionClose}
            claudeMode
          />
        </div>
      )}
      {cwdChangePrompt && sessionId && (
        <div className="claude-panel-cwd-overlay">
          <div className="claude-panel-cwd-modal">
            <p className="claude-panel-cwd-modal-text">
              Terminal changed directory to
              <br />
              <strong>{dirName(cwdChangePrompt)}</strong>
            </p>
            <div className="claude-panel-cwd-modal-actions">
              <button onClick={handleReopenInNewDir} type="button" className="primary">
                Reopen Claude here
              </button>
              <button onClick={handleDismissCwdChange} type="button" className="secondary">
                Keep current
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
