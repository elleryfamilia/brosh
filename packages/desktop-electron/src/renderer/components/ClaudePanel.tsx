/**
 * Claude Code Side Panel Component
 *
 * Right-side panel that hosts a Claude Code CLI session.
 * On first open, shows a permissions prompt. On subsequent opens,
 * restores the existing session or re-launches if the session exited.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Terminal } from "./Terminal";
import { ClaudePermissionsPrompt } from "./ClaudePermissionsPrompt";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { useSettings } from "../settings";

/** Escape a path for safe shell usage (single-quote wrapping). */
function shellEscape(p: string): string {
  if (/[^a-zA-Z0-9_./-]/.test(p)) {
    return `'${p.replace(/'/g, "'\\''")}'`;
  }
  return p;
}

/** Extract a display-friendly version string: "2.1.41 (Claude Code)" → "v2.1.41" */
function formatVersion(raw: string): string {
  const match = raw.match(/[\d]+\.[\d]+\.[\d]+/);
  return match ? `v${match[0]}` : raw;
}

/** Extract a display-friendly directory name from a full path. */
function dirName(p: string): string {
  return p.split('/').pop() ?? p;
}

/** Shell process names — when Claude exits, the foreground process returns to one of these. */
const SHELL_NAMES = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', '-bash', '-zsh', '-fish', '-sh']);

interface ClaudePanelProps {
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
  visible: boolean;
  getCwd: () => Promise<string | undefined>;
  projectName?: string | null;
  /** Session ID of the terminal pane that was focused when the panel opened */
  focusedSessionId: string | null;
}

export function ClaudePanel({
  sessionId,
  onSessionCreated,
  width,
  onResize,
  onClose,
  visible,
  getCwd,
  projectName,
  focusedSessionId,
}: ClaudePanelProps) {
  const [launching, setLaunching] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [claudeInfo, setClaudeInfo] = useState<{ model: string | null; version: string | null }>({ model: null, version: null });
  // Sticky project name: captured at launch time so it doesn't change when the user switches terminal panes
  const [stickyProjectName, setStickyProjectName] = useState<string | null>(null);
  // Track the terminal session + CWD at launch time for directory change detection
  const [launchSessionId, setLaunchSessionId] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  // CWD change prompt: shown when the launch terminal's CWD changes
  const [cwdChangePrompt, setCwdChangePrompt] = useState<string | null>(null);
  const rememberRef = useRef(false);
  const prevVisibleRef = useRef(visible);
  const { settings, updateSettings } = useSettings();


  // Fetch Claude info on mount and listen for changes
  useEffect(() => {
    window.terminalAPI.claudeGetInfo().then(setClaudeInfo);
    const cleanup = window.terminalAPI.onClaudeInfoChanged(setClaudeInfo);
    return cleanup;
  }, []);

  // Listen for CWD changes in the launch terminal session
  useEffect(() => {
    if (!launchSessionId || !launchCwd || !sessionId) return;

    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as { type: string; sessionId?: string; cwd?: string };
      if (msg.type !== 'cwd-changed') return;
      if (msg.sessionId !== launchSessionId) return;
      if (!msg.cwd || msg.cwd === launchCwd) return;

      setCwdChangePrompt(msg.cwd);
    });

    return cleanup;
  }, [launchSessionId, launchCwd, sessionId]);

  // Detect when panel is reopened from a terminal with a different CWD
  useEffect(() => {
    const wasHidden = !prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (!visible || !wasHidden) return; // Only on hidden → visible transition
    if (!sessionId) return; // No active session — fresh launch will use current terminal
    if (!focusedSessionId || focusedSessionId === launchSessionId) return; // Same terminal

    // Focused terminal changed — check if its CWD differs from Claude's launch CWD
    window.terminalAPI.getCwd(focusedSessionId).then((result) => {
      if (!result.success || !result.cwd) return;
      if (result.cwd === launchCwd) return;

      setCwdChangePrompt(result.cwd);
    });
  }, [visible, sessionId, focusedSessionId, launchSessionId, launchCwd]);

  // When the IDE WebSocket disconnects (Claude CLI exited or crashed),
  // check if the foreground process has returned to the shell — if so, close the panel.
  useEffect(() => {
    if (!sessionId) return;

    const cleanup = window.terminalAPI.onIdeClientDisconnected(async () => {
      try {
        const result = await window.terminalAPI.getProcess(sessionId);
        if (!result.success || !result.process) return;

        const proc = result.process.split('/').pop() || result.process;
        if (SHELL_NAMES.has(proc)) {
          // Claude exited — foreground is back to shell
          onSessionCreated(null as unknown as string);
          onClose();
        }
      } catch {
        // Session already destroyed
      }
    });

    return cleanup;
  }, [sessionId, onSessionCreated, onClose]);

  // Determine if we need the permissions prompt
  useEffect(() => {
    if (sessionId) return; // Already have a session
    if (launching) return; // Already launching

    const claudeSettings = settings.claude;
    if (claudeSettings?.rememberChoice) {
      // Auto-launch with remembered choice
      launchClaude(claudeSettings.dangerouslySkipPermissions);
    } else {
      setShowPrompt(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const launchClaude = useCallback(
    async (skipPermissions: boolean, overrideCwd?: string) => {
      setShowPrompt(false);
      setLaunching(true);
      setCwdChangePrompt(null);

      try {
        // Get the project CWD at launch time (from focused terminal or git root)
        const cwd = overrideCwd ?? await getCwd();

        // Capture the launch context for directory change detection
        setLaunchSessionId(focusedSessionId);
        setLaunchCwd(cwd ?? null);

        // Capture the project name at launch time so it sticks
        if (cwd) {
          const homedir = await window.terminalAPI.getHomedir();
          if (cwd !== '/' && cwd !== homedir) {
            setStickyProjectName(cwd.split('/').pop() ?? null);
          }
        }

        // Update IDE protocol lock file so Claude Code matches our workspace
        await window.terminalAPI.ideUpdateWorkspaceFolders(cwd);

        // Create a new terminal session in the project directory
        const result = await window.terminalAPI.createSession({
          cols: Math.floor(width / 9),
          rows: Math.floor(window.innerHeight / 17),
          cwd,
        });

        if (!result.success || !result.sessionId) {
          console.error("Failed to create Claude panel session:", result.error);
          setLaunching(false);
          return;
        }

        onSessionCreated(result.sessionId);

        // Wait a bit for the terminal to initialize, then cd + launch claude
        setTimeout(() => {
          const flags = skipPermissions ? " --dangerously-skip-permissions" : "";
          // cd into the project dir first as a safety net (in case createSession
          // cwd didn't take effect), then launch claude on the same line
          const cdPrefix = cwd ? `cd ${shellEscape(cwd)} && ` : "";
          window.terminalAPI.input(result.sessionId!, `${cdPrefix}claude${flags}\n`);
          setLaunching(false);
        }, 500);
      } catch (err) {
        console.error("Failed to launch Claude:", err);
        setLaunching(false);
      }
    },
    [width, getCwd, onSessionCreated, focusedSessionId]
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

  // Resize handle
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        // Panel grows to the left, so subtract delta
        const newWidth = startWidth - (ev.clientX - startX);
        onResize(newWidth);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onResize]
  );

  const handleSessionClose = useCallback(() => {
    // Session exited — close the panel. Reopening will re-launch.
    onSessionCreated(null as unknown as string);
    onClose();
  }, [onSessionCreated, onClose]);

  // Handle "Reopen in new directory" from the CWD change prompt
  const handleReopenInNewDir = useCallback(() => {
    const newCwd = cwdChangePrompt;
    if (!newCwd || !sessionId) return;

    // Kill the current Claude session by sending exit + Ctrl-C
    window.terminalAPI.input(sessionId, '\x03');
    setTimeout(() => {
      window.terminalAPI.input(sessionId, 'exit\n');
    }, 100);

    // Clear state and relaunch after a short delay
    setCwdChangePrompt(null);
    onSessionCreated(null as unknown as string);

    // Remember the permission choice from the current session
    const skipPerms = settings.claude?.dangerouslySkipPermissions ?? false;
    setTimeout(() => {
      launchClaude(skipPerms, newCwd);
    }, 600);
  }, [cwdChangePrompt, sessionId, onSessionCreated, settings.claude, launchClaude]);

  const handleDismissCwdChange = useCallback(() => {
    setCwdChangePrompt(null);
    // Update tracking to the currently focused terminal so the CWD change
    // listener watches the right session and the same path doesn't re-trigger
    if (cwdChangePrompt) setLaunchCwd(cwdChangePrompt);
    if (focusedSessionId) setLaunchSessionId(focusedSessionId);
  }, [cwdChangePrompt, focusedSessionId]);

  // Use sticky name (captured at launch), fall back to live prop (pre-launch)
  const displayName = stickyProjectName ?? projectName;

  return (
    <div className="claude-panel" style={{ width, display: visible ? undefined : 'none' }}>
      <div className="claude-panel-resize-handle" onMouseDown={handleResizeMouseDown} />
      <div className="claude-panel-header">
        <div className="claude-panel-header-title">
          <ClaudeIcon size={14} />
          <span>Claude Code{displayName ? <> — <strong>{displayName}</strong></> : ''}</span>
        </div>
        <div className="claude-panel-header-right">
          {claudeInfo.model && (
            <span className="claude-panel-model-pill">{claudeInfo.model}</span>
          )}
          {claudeInfo.version && (
            <span className="claude-panel-version">{formatVersion(claudeInfo.version)}</span>
          )}
          <button
            className="claude-panel-close"
            onClick={onClose}
            title="Close panel"
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      <div className="claude-panel-content">
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
              isVisible={true}
              isFocused={true}
              onClose={handleSessionClose}
            />
          </div>
        )}
        {cwdChangePrompt && sessionId && (
          <div className="claude-panel-cwd-overlay">
            <div className="claude-panel-cwd-modal">
              <p className="claude-panel-cwd-modal-text">
                Terminal changed directory to<br />
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
    </div>
  );
}
