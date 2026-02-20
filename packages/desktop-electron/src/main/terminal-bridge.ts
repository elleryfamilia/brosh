/**
 * Terminal Bridge
 *
 * Bridges the brosh core library with Electron's IPC system.
 * Runs brosh in-process (no subprocess needed since node-pty
 * works natively in Electron's main process).
 *
 * Each window gets its own TerminalBridge instance. IPC handlers are
 * registered globally in index.ts and dispatch to the appropriate bridge.
 */

import { shell, Notification, type BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  TerminalManager,
  GUIOutputStream,
  SandboxController,
  preWarmSession,
  type GuiMessageToFrontend,
  type ManagedSession,
  type SandboxPermissions,
} from "brosh";
import { getSettings, updateSettings } from "./settings-store.js";
import { track } from "./analytics.js";
import {
  initializeDetection,
  classifyInput,
  checkOverridePrefix,
  commandHasSubcommands,
  getSubcommands,
  isKnownCommand,
  type ClassificationResult,
  type TypoSuggestion,
} from "./ai-detection.js";
import {
  detectClaudeCode,
  invokeAI,
  formatAIResponse,
  getClaudeStatus as getClaudeStatusFromCli,
  setClaudeModel as setClaudeModelInCli,
  type DetectedBackend,
  type ClaudeStatus,
  type ClaudeModel,
} from "./ai-cli.js";
import {
  createMarkdownStreamState,
  processMarkdownChunk,
  flushMarkdownStream,
  type MarkdownStreamState,
} from "./markdown-terminal.js";
import {
  triageError,
  buildTriagePrompt,
} from "./error-triage.js";

// AI settings type matching settings-store.ts
interface AISettingsFromStore {
  enabled: boolean;
  confirmBeforeInvoking: boolean;
  showIndicator: boolean;
  denylist: string;
}

// Log for debugging
const debug = (msg: string, ...args: unknown[]) => {
  console.log(`[terminal-bridge] ${msg}`, ...args);
};

/**
 * Parse OSC (Operating System Command) escape sequences from terminal output.
 * These are used by shells to set window/tab titles.
 *
 * Format: ESC ] <code> ; <text> BEL  or  ESC ] <code> ; <text> ESC \
 * - OSC 0: Set icon name and window title
 * - OSC 1: Set icon name
 * - OSC 2: Set window title
 */
function parseOscTitle(data: string): string | null {
  // Match OSC 0, 1, or 2 sequences
  // ESC ] (0|1|2) ; <title> (BEL | ESC \)
  // \x1b = ESC, \x07 = BEL, \x1b\\ = ST (String Terminator)
  const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

  let lastTitle: string | null = null;
  let match;

  while ((match = oscRegex.exec(data)) !== null) {
    const code = match[1];
    const title = match[2];

    // OSC 0 and OSC 2 set the window title (OSC 1 is just icon name)
    if (code === '0' || code === '2') {
      lastTitle = title;
    }
  }

  return lastTitle;
}

/**
 * Check if an OSC title is useful to display.
 *
 * We want to show:
 * - Process/shell names (zsh, bash, node, python, htop, etc.)
 * - AI tool status messages (Claude working, etc.)
 * - Any meaningful application title
 *
 * We DON'T want to show:
 * - "user@host:path" format (shell prompt with current directory)
 * - Just paths like "~/projects" or "/usr/bin"
 * - "dirname — shell" theme format that includes the directory
 *
 * Returns true if the title should be displayed, false if it should be ignored.
 */
function isUsefulTitle(title: string): boolean {
  if (!title || title.trim() === '') return false;

  const trimmed = title.trim();

  // Ignore shell prompt style titles: "user@host:path" or "user@host: path"
  if (/^[\w-]+@[\w.-]+:\s*/.test(trimmed)) {
    return false;
  }

  // Ignore titles that are just paths
  if (/^[\/~]/.test(trimmed)) {
    return false;
  }

  // Ignore titles that look like "dirname — shellname" (common zsh theme format)
  // e.g., "brosh — zsh" or "~ — bash"
  if (/\s[—–-]\s*\w+$/.test(trimmed) && /^[\/~.]|\.\./.test(trimmed.split(/\s[—–-]\s*/)[0])) {
    return false;
  }

  // Everything else is useful (shell names, process names, AI status, etc.)
  return true;
}

/**
 * Parse OSC 9 and OSC 777 notification sequences from terminal output.
 * These are used by programs to send desktop notifications.
 *
 * Format:
 * - OSC 9: ESC ] 9 ; <message> BEL - Simple notification
 * - OSC 777: ESC ] 777 ; notify ; <title> ; <body> BEL - Rich notification with title
 */
interface TerminalNotification {
  title?: string;
  body: string;
}

function parseOscNotification(data: string): TerminalNotification | null {
  // OSC 9: Simple notification - \x1b]9;message\x07 or \x1b]9;message\x1b\\
  const osc9Regex = /\x1b\]9;([^\x07\x1b]*?)(?:\x07|\x1b\\)/;
  const osc9Match = osc9Regex.exec(data);
  if (osc9Match) {
    return {
      body: osc9Match[1],
    };
  }

  // OSC 777: Rich notification - \x1b]777;notify;title;body\x07 or \x1b]777;notify;title;body\x1b\\
  const osc777Regex = /\x1b\]777;notify;([^;]*);([^\x07\x1b]*?)(?:\x07|\x1b\\)/;
  const osc777Match = osc777Regex.exec(data);
  if (osc777Match) {
    return {
      title: osc777Match[1],
      body: osc777Match[2],
    };
  }

  return null;
}

/**
 * Parse OSC 133 shell integration sequences from terminal output.
 * These mark command boundaries for navigation and visual indicators.
 *
 * Format: ESC ] 133 ; <code> [; <params>] BEL
 * - A: Prompt start
 * - B: Prompt end / command input start
 * - C: Command executed / output start
 * - D [; exitcode]: Command finished
 */
interface CommandMark {
  type: 'prompt-start' | 'command-start' | 'output-start' | 'command-end';
  exitCode?: number;
}

function parseOsc133(data: string): CommandMark[] {
  const marks: CommandMark[] = [];
  const regex = /\x1b\]133;([ABCD])(?:;(\d+))?(?:\x07|\x1b\\)/g;

  let match;
  while ((match = regex.exec(data)) !== null) {
    const code = match[1];
    const param = match[2];

    switch (code) {
      case 'A':
        marks.push({ type: 'prompt-start' });
        break;
      case 'B':
        marks.push({ type: 'command-start' });
        break;
      case 'C':
        marks.push({ type: 'output-start' });
        break;
      case 'D':
        marks.push({
          type: 'command-end',
          exitCode: param !== undefined ? parseInt(param, 10) : undefined,
        });
        break;
    }
  }

  return marks;
}

/**
 * Parse OSC 7 directory change sequences from terminal output.
 * Shells emit this when the working directory changes.
 *
 * Format: ESC ] 7 ; file://hostname/path BEL  or  ESC ] 7 ; file://hostname/path ESC \
 * Returns the directory path if found, null otherwise.
 */
function parseOsc7(data: string): string | null {
  // Match OSC 7 sequence with file:// URL
  // \x1b = ESC, \x07 = BEL, \x1b\\ = ST (String Terminator)
  const osc7Regex = /\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/;
  const match = osc7Regex.exec(data);

  if (match && match[1]) {
    // Decode URL-encoded path (e.g., %20 -> space)
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return null;
}

// Import type only to avoid circular dependency
import type { McpServer } from "./mcp-server.js";
import type { IdeProtocolServer } from "./ide-protocol.js";

// Sandbox configuration types
interface SandboxConfig {
  filesystem: {
    readWrite: string[];
    readOnly: string[];
    blocked: string[];
  };
  network: {
    mode: 'all' | 'none' | 'allowlist';
    allowedDomains?: string[];
  };
}

export class TerminalBridge {
  private manager: TerminalManager | null = null;
  private guiStream: GUIOutputStream;
  private window: BrowserWindow;
  private clientId: string | null = null;
  private disposed = false;

  // Track sessions for event forwarding
  private sessionEventHandlers: Map<string, { cleanup: () => void }> = new Map();

  // Track session-to-recording mappings
  private sessionRecordings: Map<string, string> = new Map();

  // Callback for when manager is ready
  private managerReadyCallbacks: Array<(manager: TerminalManager) => void> = [];

  // MCP server reference for session attachment
  private mcpServer: McpServer | null = null;
  private ideProtocolServer: IdeProtocolServer | null = null;

  // Track if first session has been created (for auto-attach)
  private firstSessionCreated = false;

  // Sandbox mode configuration
  private sandboxConfig: SandboxConfig | null = null;
  private sandboxController: SandboxController | null = null;
  private useSandboxMode = false;

  // AI detection state
  private aiDetectionInitialized = false;
  private claudeCode: DetectedBackend | null = null;
  private sessionLineBuffers: Map<string, string> = new Map();
  private sessionAIActive: Map<string, { cancel: () => void } | null> = new Map();
  private sessionAtPrompt: Map<string, boolean> = new Map(); // Track if session is at shell prompt

  // Track last command text per session (for error triage context)
  private sessionLastCommand: Map<string, string> = new Map();

  // Track pending error triage processes (for cancellation)
  private sessionErrorTriage: Map<string, { cancel: () => void }> = new Map();

  // Rate limit: track last error triage timestamp per session
  private sessionLastTriageTime: Map<string, number> = new Map();

  // Track if a command was fast-tracked (known command, skipped ML)
  private sessionFastTracked: Map<string, boolean> = new Map();
  // Count output lines for fast-tracked commands (for retroactive erasure)
  private sessionFastTrackLines: Map<string, number> = new Map();

  // Autocomplete state
  private sessionAutocomplete: Map<string, { suggestion: string; ghostText: string } | null> = new Map();


  // AI session context (for session persistence)
  // Each terminal session tracks separate session IDs per backend
  // This allows switching between backends without losing conversation history
  private sessionAIContexts: Map<string, {
    // Backend-specific session IDs (e.g., claude -> "uuid", codex -> "uuid")
    backendSessions: { [backendId: string]: string };
    lastQuery?: string;
  }> = new Map();

  // AI loading spinner state
  private sessionAISpinner: Map<string, {
    timer: ReturnType<typeof setInterval>;
    frameIdx: number;
  }> = new Map();


  // Spinner animation frames (braille pattern)
  private static readonly SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];


  // Power management state for battery optimization
  private windowFocused = true;
  private systemSuspended = false;

  // Buffered PTY output during display sleep — avoids IPC + xterm.js rendering to invisible canvas
  // Key: sessionId, Value: array of base64-encoded data chunks
  private suspendedOutputBuffer: Map<string, string[]> = new Map();

  // Speculative standard-mode session — pre-created while the mode selection
  // modal is visible so the first "Standard" click is near-instant.
  // Disposed if the user picks sandbox mode instead.
  private speculativeSession: {
    session: ManagedSession;
    consumed: boolean;
    cwd: string;
  } | null = null;
  private speculativeSessionReady: Promise<void> | null = null;

  constructor(window: BrowserWindow) {
    this.window = window;
    this.guiStream = new GUIOutputStream();

    // Note: IPC handlers are now registered globally in index.ts
    // This bridge is just responsible for managing terminals for this window

    // Set up GUI stream client that sends to renderer
    this.clientId = this.guiStream.addClient((message: GuiMessageToFrontend) => {
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:message", message);
      }
    });

    // Handle stream errors
    this.guiStream.on("error", (error) => {
      console.error("[terminal-bridge] Stream error:", error.message);
    });

    // Initialize AI detection system
    this.initializeAIDetection();

    // Pre-warm terminal session resources and speculatively create a standard
    // session while the mode selection modal is visible. This front-loads
    // ~600-1000ms of PTY spawn + shell init time so "Standard" click is instant.
    setTimeout(() => {
      const settings = getSettings();
      preWarmSession({ nativeShell: true, setLocaleEnv: settings.terminal.setLocaleEnv });
      this.speculativeSessionReady = this.preCreateStandardSession();
    }, 0);
  }

  /**
   * Initialize AI detection system (async, non-blocking)
   */
  private async initializeAIDetection(): Promise<void> {
    try {
      // Initialize command cache and preload ML model for detection
      await initializeDetection({ preloadML: true });

      // Check if Claude Code CLI is installed
      this.claudeCode = detectClaudeCode();

      if (this.claudeCode) {
        debug(`AI detection initialized. Claude Code found at ${this.claudeCode.path}`);

        // Apply stored model setting
        const settings = getSettings();
        if (settings.ai?.model) {
          setClaudeModelInCli(settings.ai.model as ClaudeModel);
          debug(`Applied stored model setting: ${settings.ai.model}`);
        }
      } else {
        debug("AI detection initialized. Claude Code CLI not installed.");
      }

      this.aiDetectionInitialized = true;
    } catch (error) {
      console.error("[terminal-bridge] Failed to initialize AI detection:", error);
      this.aiDetectionInitialized = true; // Mark as initialized to avoid blocking
    }
  }

  /**
   * Speculatively create a standard-mode terminal session while the mode
   * selection modal is visible. If the user clicks "Standard", we hand back
   * this pre-created session (near-instant). If they pick sandbox, we dispose
   * it and create a fresh one with the sandbox controller.
   */
  private async preCreateStandardSession(): Promise<void> {
    // Guard: skip if a speculative session is already available
    if (this.speculativeSession) return;

    try {
      const settings = getSettings();

      // Create manager early (standard mode — no sandbox controller)
      if (!this.manager) {
        this.manager = new TerminalManager({
          cols: 120,
          rows: 40,
          nativeShell: true,
          setLocaleEnv: settings.terminal.setLocaleEnv,
        });
        this.guiStream.attachManager(this.manager);

        for (const callback of this.managerReadyCallbacks) {
          callback(this.manager);
        }
      }

      const cwd = os.homedir();
      const session = await this.manager.createSession({ cols: 120, rows: 40, cwd });

      this.speculativeSession = { session, consumed: false, cwd };
      debug("Pre-created speculative standard session:", session.id);
    } catch (err) {
      console.error("[terminal-bridge] Failed to pre-create speculative session:", err);
      this.speculativeSession = null;
    }
  }

  /**
   * Check if Claude Code CLI is installed
   */
  isClaudeCodeInstalled(): boolean {
    return this.claudeCode !== null;
  }

  /**
   * Get comprehensive Claude Code CLI status
   */
  getClaudeStatus(): ClaudeStatus {
    return getClaudeStatusFromCli();
  }

  /**
   * Set the Claude model
   */
  setClaudeModel(model: ClaudeModel): { success: boolean } {
    setClaudeModelInCli(model);
    // Also update settings
    const settings = getSettings();
    updateSettings({
      ai: { ...settings.ai, model },
    });
    return { success: true };
  }

  // ==========================================
  // Public methods for IPC handlers (called from index.ts)
  // ==========================================

  /**
   * Create a new terminal session
   */
  async createSession(options?: {
    cols?: number;
    rows?: number;
    shell?: string;
    cwd?: string;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    cols?: number;
    rows?: number;
    error?: string;
  }> {
    debug("Creating terminal session with options:", options);
    try {
      // Wait for speculative session creation to finish (if still in flight)
      if (this.speculativeSessionReady) {
        await this.speculativeSessionReady;
        this.speculativeSessionReady = null;
      }

      // ── Fast path: consume the speculative standard-mode session ──
      if (!this.useSandboxMode && this.speculativeSession && !options?.shell) {
        const spec = this.speculativeSession;
        this.speculativeSession = null;
        spec.consumed = true; // stop buffering new data

        const session = spec.session;
        const sessionId = session.id;

        // Resize if the renderer's dimensions differ from the default 120×40
        const cols = options?.cols ?? 120;
        const rows = options?.rows ?? 40;
        const dims = session.getDimensions();
        if (cols !== dims.cols || rows !== dims.rows) {
          session.resize(cols, rows);
        }

        // Set up event forwarding (new onData listener takes over from here)
        const cwd = options?.cwd ?? spec.cwd;
        this.setupSessionEvents(session, cwd);

        // Force the shell to redraw its prompt at the correct dimensions once
        // the renderer has mounted. We don't replay the old buffered data because
        // it was formatted for the speculative 120×40 PTY — replaying it at a
        // different width garbles zsh's PROMPT_SP escape (the visible `%` bug).
        setTimeout(() => {
          if (!this.disposed && session.isActive()) {
            session.resize(cols, rows);
          }
        }, 80);

        if (!this.firstSessionCreated) {
          this.firstSessionCreated = true;
        }

        debug("Used speculative session:", sessionId, session.getDimensions());

        // Pre-create the next speculative session so the next split/window is instant
        this.speculativeSessionReady = this.preCreateStandardSession();

        const finalDims = session.getDimensions();
        return {
          success: true,
          sessionId,
          cols: finalDims.cols,
          rows: finalDims.rows,
        };
      }

      // ── Sandbox path: dispose speculative session + manager ──
      if (this.speculativeSession) {
        const spec = this.speculativeSession;
        this.speculativeSession = null;
        spec.consumed = true;
        debug("Disposing speculative session for sandbox mode:", spec.session.id);
        this.manager?.closeSession(spec.session.id);
        // Manager was created without sandbox controller — recreate it
        if (this.manager) {
          this.manager.dispose();
          this.manager = null;
        }
      }

      // ── Normal path: create manager + session from scratch ──
      if (!this.manager) {
        const settings = getSettings();
        debug("Creating new TerminalManager", {
          useSandboxMode: this.useSandboxMode,
          hasSandboxController: !!this.sandboxController,
          setLocaleEnv: settings.terminal.setLocaleEnv,
        });
        this.manager = new TerminalManager({
          cols: options?.cols ?? 120,
          rows: options?.rows ?? 40,
          shell: options?.shell,
          cwd: options?.cwd,
          nativeShell: true,
          setLocaleEnv: settings.terminal.setLocaleEnv,
          sandboxController: this.useSandboxMode ? this.sandboxController ?? undefined : undefined,
        });
        this.guiStream.attachManager(this.manager);

        for (const callback of this.managerReadyCallbacks) {
          callback(this.manager);
        }
      }

      const cwd = options?.cwd ?? os.homedir();
      debug("Creating new session with cwd:", cwd);
      const session = await this.manager.createSession({
        cols: options?.cols ?? 120,
        rows: options?.rows ?? 40,
        shell: options?.shell,
        cwd,
      });
      debug("Session created:", session.id);

      this.setupSessionEvents(session, cwd);
      debug("Event forwarding set up for", session.id);

      if (!this.firstSessionCreated) {
        this.firstSessionCreated = true;
      }

      const dims = session.getDimensions();
      debug("Session ready:", session.id, dims);

      if (this.useSandboxMode) {
        setTimeout(() => {
          if (session.isActive()) {
            session.write('clear\n');
          }
        }, 300);
      } else {
        // Pre-create the next speculative session for instant split panes
        this.speculativeSessionReady = this.preCreateStandardSession();
      }

      return {
        success: true,
        sessionId: session.id,
        cols: dims.cols,
        rows: dims.rows,
      };
    } catch (error) {
      console.error("[terminal-bridge] Failed to create session:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Shell processes where AI detection should be active
  // Only detect AI at shell prompts, not inside TUI apps
  private static readonly SHELL_PROCESSES = new Set([
    'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh',
    // Also allow when shell is the login shell variant
    '-bash', '-zsh', '-fish', '-sh',
  ]);

  /**
   * Check if the foreground process is a shell (where AI detection should be active)
   */
  private isAtShellPrompt(session: { getProcess: () => string }): boolean {
    try {
      const processName = session.getProcess();
      // Extract just the process name (might be full path)
      const baseName = processName.split('/').pop() || processName;
      return TerminalBridge.SHELL_PROCESSES.has(baseName);
    } catch {
      // If we can't determine the process, assume shell (for safety)
      return true;
    }
  }

  /**
   * Send input to terminal with AI detection
   */
  input(sessionId: string, data: string): { success: boolean; error?: string } {
    if (!this.manager) return { success: false, error: "No manager" };

    const session = this.manager.getSessionById(sessionId);
    if (!session || !session.isActive()) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    // Get AI settings
    const settings = getSettings();
    const defaultAISettings: AISettingsFromStore = {
      enabled: true,
      confirmBeforeInvoking: false,
      showIndicator: true,
      denylist: '',
    };
    const aiSettings = settings.ai || defaultAISettings;

    // Debug: Log AI settings state on Enter key
    if (data === '\r' || data === '\n') {
      debug(`AI settings check: enabled=${aiSettings.enabled}, initialized=${this.aiDetectionInitialized}, claudeCode=${!!this.claudeCode}`);
    }

    // If AI detection is disabled or not initialized or Claude Code not installed, pass through directly
    if (!aiSettings.enabled || !this.aiDetectionInitialized || !this.claudeCode) {
      if (data === '\r' || data === '\n') {
        debug(`AI bypassed: enabled=${aiSettings.enabled}, initialized=${this.aiDetectionInitialized}, claudeCode=${!!this.claudeCode}`);
      }
      session.write(data);
      return { success: true };
    }

    // If not at a shell prompt (e.g., inside vim, claude TUI, less, etc.), bypass AI detection
    // This prevents AI detection from interfering with TUI applications
    if (!this.isAtShellPrompt(session)) {
      if (data === '\r' || data === '\n') {
        debug(`AI bypassed: not at shell prompt (foreground process is not a shell)`);
      }
      session.write(data);
      return { success: true };
    }

    // If AI is currently active for this session, ignore input (or could send to AI stdin)
    if (this.sessionAIActive.get(sessionId)) {
      // Could potentially send input to AI process, but for now just ignore
      return { success: true };
    }

    // Handle the input with line buffering for AI detection
    // Note: This starts an async operation but returns sync result
    this.handleInputWithAIDetection(session, sessionId, data, aiSettings);
    return { success: true };
  }

  /**
   * Handle input with AI detection logic
   * Classification is async (ML-based) but only runs on Enter
   */
  private async handleInputWithAIDetection(
    session: { write: (data: string) => void },
    sessionId: string,
    data: string,
    aiSettings: AISettingsFromStore
  ): Promise<void> {
    // Get or initialize line buffer for this session
    let lineBuffer = this.sessionLineBuffers.get(sessionId) || "";

    // Handle multi-character input (paste or programmatic, e.g. from "Diagnose with AI")
    // AI detection is designed for single-keystroke input; multi-char strings bypass it.
    if (data.length > 1 && !data.startsWith("\x1b")) {
      const hasNewline = data.includes("\r") || data.includes("\n");

      if (hasNewline) {
        // Extract text before the first newline for override prefix check
        const nlIdx = data.search(/[\r\n]/);
        const textBeforeNl = data.substring(0, nlIdx).trim();

        if (textBeforeNl) {
          const { override, cleanedInput } = checkOverridePrefix(textBeforeNl);

          if (override === "NATURAL_LANGUAGE") {
            // Programmatic AI invocation (e.g., "? query\n" from Diagnose with AI)
            this.sessionLastCommand.set(sessionId, cleanedInput);
            this.sessionLineBuffers.set(sessionId, "");
            this.clearAutocomplete(sessionId);
            // Clear terminal line and invoke AI directly (don't send to shell)
            session.write("\x15");
            this.invokeAIForSession(session, sessionId, cleanedInput, aiSettings);
            return;
          }
        }

        // Regular paste with newline — pass through to shell, clear buffer
        this.sessionLastCommand.set(sessionId, textBeforeNl || lineBuffer.trim());
        this.sessionLineBuffers.set(sessionId, "");
        this.clearAutocomplete(sessionId);
        session.write(data);
        return;
      }

      // Multi-char paste without newline — append to buffer and pass through
      lineBuffer += data;
      this.sessionLineBuffers.set(sessionId, lineBuffer);
      session.write(data);
      this.updateAutocomplete(sessionId, lineBuffer);
      return;
    }

    // Check for special characters (single-keystroke input)
    const isEnter = data === "\r" || data === "\n" || data === "\r\n";
    const isBackspace = data === "\x7f" || data === "\b";
    const isCtrlC = data === "\x03";
    const isCtrlU = data === "\x15"; // Clear line
    const isEscape = data === "\x1b";
    const isTab = data === "\t";
    const isRightArrow = data === "\x1b[C";

    // Handle Tab or Right Arrow - accept autocomplete
    if (isTab || isRightArrow) {
      // Check for autocomplete suggestion (Tab or Right Arrow accepts)
      const autocomplete = this.sessionAutocomplete.get(sessionId);
      if (autocomplete) {
        // Accept autocomplete - append the ghost text
        const ghostText = autocomplete.ghostText;
        lineBuffer += ghostText;
        this.sessionLineBuffers.set(sessionId, lineBuffer);
        this.clearAutocomplete(sessionId);
        // Write the ghost text to terminal
        session.write(ghostText);
        // Update autocomplete for the new buffer
        this.updateAutocomplete(sessionId, lineBuffer);
        return;
      }

      // No autocomplete - pass through to shell
      // Tab goes to shell for completion, Right Arrow moves cursor
      session.write(data);
      return;
    }

    // Handle Ctrl+C - cancel any AI invocation and clear buffer
    if (isCtrlC) {
      const aiHandle = this.sessionAIActive.get(sessionId);
      if (aiHandle) {
        aiHandle.cancel();
        this.sessionAIActive.delete(sessionId);
        // Stop spinner if running
        this.stopLoadingAnimation(sessionId);
        // Show cancellation message
        this.writeToTerminalDisplay(sessionId, "\r\n\x1b[38;5;240m(cancelled)\x1b[0m\r\n");
      }
      this.sessionLineBuffers.set(sessionId, "");
      this.clearAutocomplete(sessionId);
      session.write(data);
      return;
    }

    // Handle backspace - remove last character from buffer
    if (isBackspace) {
      if (lineBuffer.length > 0) {
        lineBuffer = lineBuffer.slice(0, -1);
        this.sessionLineBuffers.set(sessionId, lineBuffer);
      }
      // Update autocomplete for the new buffer
      this.updateAutocomplete(sessionId, lineBuffer);
      session.write(data);
      return;
    }

    // Handle Ctrl+U - clear line buffer
    if (isCtrlU) {
      this.sessionLineBuffers.set(sessionId, "");
      this.clearAutocomplete(sessionId);
      session.write(data);
      return;
    }

    // Handle Escape sequences (arrow keys, etc.) - pass through
    if (isEscape || data.startsWith("\x1b")) {
      session.write(data);
      return;
    }

    // Handle Enter - this is where we decide command vs NL (async ML classification)
    if (isEnter) {
      const trimmedLine = lineBuffer.trim();
      debug(`Enter pressed, raw buffer: "${lineBuffer}", trimmed: "${trimmedLine}"`);

      // Clear autocomplete on Enter
      this.clearAutocomplete(sessionId);

      // If line buffer is empty, just pass through to the shell
      // This handles:
      // - Empty line (user just pressed Enter)
      // - Arrow-up history recall (we didn't see the characters being typed)
      // - Commands typed before AI detection initialized
      //
      // Trying to read from the terminal is unreliable with fancy prompts,
      // so we let the shell handle it - it knows what command was recalled.
      if (!trimmedLine) {
        this.sessionLineBuffers.set(sessionId, "");
        session.write(data);
        return;
      }

      // Check for user override prefixes (! for command, ? for AI)
      const { override, cleanedInput } = checkOverridePrefix(trimmedLine);

      if (override === "COMMAND") {
        // User forced command mode - clear the current line and send the cleaned command
        this.sessionLastCommand.set(sessionId, cleanedInput);
        this.sessionLineBuffers.set(sessionId, "");
        // Clear the line in terminal (Ctrl+U equivalent) and retype without prefix
        session.write("\x15" + cleanedInput + "\r");
        return;
      }

      if (override === "NATURAL_LANGUAGE") {
        // User forced AI mode
        this.sessionLastCommand.set(sessionId, cleanedInput);
        this.sessionLineBuffers.set(sessionId, "");
        this.invokeAIForSession(session, sessionId, cleanedInput, aiSettings);
        return;
      }

      // Check denylist
      const denylist = aiSettings.denylist
        ? aiSettings.denylist.split(",").map((s) => s.trim().toLowerCase())
        : [];
      const firstWord = trimmedLine.split(/\s+/)[0].toLowerCase();
      if (denylist.includes(firstWord)) {
        // Command is in denylist - pass through
        this.sessionLastCommand.set(sessionId, trimmedLine);
        this.sessionLineBuffers.set(sessionId, "");
        session.write(data);
        return;
      }

      // Known command fast-track: skip ML entirely for recognized executables
      if (isKnownCommand(firstWord)) {
        debug(`Known command: "${firstWord}", skipping ML`);
        this.sessionLastCommand.set(sessionId, trimmedLine);
        this.sessionFastTracked.set(sessionId, true);
        this.sessionFastTrackLines.set(sessionId, 0);
        this.sessionLineBuffers.set(sessionId, "");
        session.write(data);
        return;
      }

      // Classify the input using ML (async)
      this.sessionFastTracked.set(sessionId, false);
      const result = await classifyInput(trimmedLine);
      debug(`Classification: "${trimmedLine.substring(0, 50)}..." -> ${result.classification} (${result.confidence.toFixed(2)}, tier ${result.tier}, reason: ${result.reason})`);

      if (result.classification === "NATURAL_LANGUAGE" && result.confidence >= 0.7) {
        // High confidence NL - invoke AI
        this.sessionLastCommand.set(sessionId, trimmedLine);
        this.sessionLineBuffers.set(sessionId, "");
        this.invokeAIForSession(session, sessionId, trimmedLine, aiSettings);
        return;
      }

      // Command or ambiguous - pass through to shell
      debug(`Passing through to shell: "${trimmedLine.substring(0, 30)}..." (${result.classification})`);
      this.sessionLastCommand.set(sessionId, trimmedLine);
      this.sessionLineBuffers.set(sessionId, "");
      session.write(data);
      return;
    }

    // Regular character - add to buffer and pass through
    lineBuffer += data;
    this.sessionLineBuffers.set(sessionId, lineBuffer);
    debug(`Buffer updated: "${lineBuffer}"`);

    // Write character to terminal FIRST, then update autocomplete
    // This ensures the terminal has rendered the character before
    // autocomplete events are sent (fixes ghost text positioning)
    session.write(data);

    // Update autocomplete suggestions
    // Must happen AFTER session.write so terminal has the character
    this.updateAutocomplete(sessionId, lineBuffer);
  }

  /**
   * Write data directly to terminal display (bypassing shell)
   *
   * This sends output directly to the renderer's xterm.js,
   * unlike session.write() which goes to the PTY input.
   */
  private writeToTerminalDisplay(sessionId: string, data: string): void {
    if (!this.disposed && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("terminal:message", {
        type: "output",
        sessionId,
        data: Buffer.from(data).toString("base64"),
      });
    }
  }

  /**
   * Update autocomplete suggestion for subcommands
   * Shows ghost text completion when typing subcommands for known commands
   */
  private updateAutocomplete(sessionId: string, buffer: string): void {
    const trimmed = buffer.trim();
    const words = trimmed.split(/\s+/);
    const firstWord = words[0] || "";
    const partialSecond = words[1] || "";

    // Only show autocomplete if:
    // 1. First word is a known command with subcommands
    // 2. User has typed a space and started typing second word
    // 3. The partial matches a subcommand prefix
    if (!buffer.includes(" ") || !partialSecond || !commandHasSubcommands(firstWord)) {
      this.clearAutocomplete(sessionId);
      return;
    }

    // Don't autocomplete if there are more words (user is past the subcommand)
    if (words.length > 2) {
      this.clearAutocomplete(sessionId);
      return;
    }

    const subcommands = getSubcommands(firstWord);
    if (!subcommands) {
      this.clearAutocomplete(sessionId);
      return;
    }

    // Find matching subcommand
    const partial = partialSecond.toLowerCase();
    let bestMatch: string | null = null;

    for (const subcmd of subcommands) {
      if (subcmd.startsWith(partial) && subcmd !== partial) {
        // Found a prefix match - use the first one alphabetically
        if (!bestMatch || subcmd < bestMatch) {
          bestMatch = subcmd;
        }
      }
    }

    if (bestMatch) {
      const ghostText = bestMatch.slice(partial.length);
      const fullSuggestion = `${firstWord} ${bestMatch}`;

      const prev = this.sessionAutocomplete.get(sessionId);
      if (prev?.suggestion !== fullSuggestion) {
        this.sessionAutocomplete.set(sessionId, { suggestion: fullSuggestion, ghostText });
        debug(`Autocomplete for ${sessionId}: "${partialSecond}" → "${bestMatch}" (ghost: "${ghostText}")`);

        if (!this.disposed && this.window && !this.window.isDestroyed()) {
          this.window.webContents.send("terminal:autocomplete", {
            sessionId,
            suggestion: fullSuggestion,
            ghostText,
          });
        }
      }
    } else {
      this.clearAutocomplete(sessionId);
    }
  }

  /**
   * Clear autocomplete suggestion for a session
   */
  private clearAutocomplete(sessionId: string): void {
    if (this.sessionAutocomplete.get(sessionId)) {
      this.sessionAutocomplete.delete(sessionId);
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:autocomplete", {
          sessionId,
          suggestion: null,
          ghostText: null,
        });
      }
    }
  }

  /**
   * Accept the current autocomplete suggestion
   */
  acceptAutocomplete(sessionId: string): { accepted: boolean; text?: string } {
    const autocomplete = this.sessionAutocomplete.get(sessionId);
    if (!autocomplete) {
      return { accepted: false };
    }

    // Return the ghost text to append
    this.clearAutocomplete(sessionId);
    return { accepted: true, text: autocomplete.ghostText };
  }

  /**
   * Start a loading animation (spinner) for AI response
   * Uses 120ms interval (8 FPS) - smooth enough for text, saves 33% CPU vs 80ms
   */
  private startLoadingAnimation(sessionId: string): void {
    // Don't start if window is blurred or system is suspended
    if (!this.windowFocused || this.systemSuspended) {
      return;
    }

    // Clear any existing spinner
    this.stopLoadingAnimation(sessionId);

    let frameIdx = 0;
    const timer = setInterval(() => {
      const frame = TerminalBridge.SPINNER_FRAMES[frameIdx];
      // Move cursor to beginning, show spinner with "thinking...", clear rest of line
      this.writeToTerminalDisplay(sessionId, `\r\x1b[38;5;141m${frame} thinking...\x1b[0m\x1b[K`);
      frameIdx = (frameIdx + 1) % TerminalBridge.SPINNER_FRAMES.length;
    }, 120);

    this.sessionAISpinner.set(sessionId, { timer, frameIdx });
  }

  /**
   * Stop the loading animation and clear the spinner line
   */
  private stopLoadingAnimation(sessionId: string): void {
    const spinner = this.sessionAISpinner.get(sessionId);
    if (spinner) {
      clearInterval(spinner.timer);
      this.sessionAISpinner.delete(sessionId);
      // Clear the spinner line
      this.writeToTerminalDisplay(sessionId, '\r\x1b[K');
    }
  }

  /**
   * Get or create AI context for a session
   */
  private getAIContext(sessionId: string): { backendSessions: { [backendId: string]: string }; lastQuery?: string } {
    let ctx = this.sessionAIContexts.get(sessionId);
    if (!ctx) {
      ctx = { backendSessions: {} };
      this.sessionAIContexts.set(sessionId, ctx);
    }
    return ctx;
  }

  /**
   * Get the Claude session ID for a terminal session (if any)
   */
  public getClaudeSessionId(sessionId: string): string | null {
    const ctx = this.sessionAIContexts.get(sessionId);
    return ctx?.backendSessions["claude"] ?? null;
  }

  /**
   * Invoke AI CLI for a session
   */
  private invokeAIForSession(
    session: { write: (data: string) => void },
    sessionId: string,
    query: string,
    aiSettings: AISettingsFromStore
  ): void {
    // Clear the current line in terminal by sending Ctrl+U to the shell
    session.write("\x15"); // Ctrl+U to clear line

    // Write newline directly to terminal display (not to shell)
    this.writeToTerminalDisplay(sessionId, "\r\n");

    // Get AI context for this session (for session resume)
    const aiContext = this.getAIContext(sessionId);
    aiContext.lastQuery = query;

    // Get the Claude session ID (if any) for resume
    const existingClaudeSessionId = aiContext.backendSessions["claude"];
    const isFirstMessage = !existingClaudeSessionId;

    // Track the current session ID (will be updated when we receive it)
    let currentClaudeSessionId = existingClaudeSessionId;

    // Track timing for response duration
    const startTime = Date.now();

    // Track if we've shown the header (separate from data receipt)
    let headerShown = false;

    // Create markdown streaming state for formatting AI responses
    const markdownState = createMarkdownStreamState();

    // Store handle reference for callbacks (will be set after invokeAI returns)
    let handleRef: { cancel: () => void; backend: DetectedBackend } | null = null;

    // Track AI invocation
    track('ai_invocation', { model: 'claude' });

    // Use terminal session's cwd so the Claude session is stored under the correct project
    const sessionCwd = this.getCwd(sessionId);
    const cwd = sessionCwd.success && sessionCwd.cwd ? sessionCwd.cwd : process.cwd();

    // Invoke Claude Code CLI
    const handle = invokeAI(
      query,
      this.claudeCode,
      {
        cwd,
        shell: process.env.SHELL,
        sessionId: existingClaudeSessionId, // Pass existing Claude session ID (if any)
        onData: (data) => {
          // Process markdown and convert to ANSI-formatted terminal output
          const terminalData = processMarkdownChunk(data, markdownState);

          // Only stop spinner and show header when we have actual content to display
          // This prevents the delay between header and content
          if (terminalData && !headerShown) {
            headerShown = true;
            this.stopLoadingAnimation(sessionId);

            // Show AI indicator with backend name and session ID if enabled
            if (aiSettings.showIndicator && handleRef) {
              const backendName = this.getBackendDisplayName(handleRef.backend);
              this.writeToTerminalDisplay(
                sessionId,
                formatAIResponse("", true, false, backendName, undefined, currentClaudeSessionId, isFirstMessage)
              );
            }
          }

          if (terminalData) {
            this.writeToTerminalDisplay(sessionId, terminalData);
          }
        },
        onError: (error) => {
          // Stop spinner on error
          this.stopLoadingAnimation(sessionId);
          this.writeToTerminalDisplay(sessionId, `\r\n\x1b[31mError: ${error}\x1b[0m\r\n`);
        },
        onEnd: (exitCode) => {
          // Stop spinner if still running (in case of empty response)
          this.stopLoadingAnimation(sessionId);

          // Flush any remaining markdown content
          const remaining = flushMarkdownStream(markdownState);

          // If we have remaining content but never showed header, show it now
          if (remaining && !headerShown && aiSettings.showIndicator && handleRef) {
            headerShown = true;
            const backendName = this.getBackendDisplayName(handleRef.backend);
            this.writeToTerminalDisplay(
              sessionId,
              formatAIResponse("", true, false, backendName, undefined, currentClaudeSessionId, isFirstMessage)
            );
          }

          if (remaining) {
            this.writeToTerminalDisplay(sessionId, remaining + "\r\n");
          }

          // Calculate elapsed time
          const elapsedMs = Date.now() - startTime;

          // Show end indicator if enabled (only if we showed content)
          if (aiSettings.showIndicator && headerShown) {
            const backendName = handleRef ? this.getBackendDisplayName(handleRef.backend) : undefined;
            this.writeToTerminalDisplay(sessionId, formatAIResponse("", false, true, backendName, elapsedMs));
          }

          // Clean up
          this.sessionAIActive.delete(sessionId);

          // Send a newline to shell to get back to prompt
          // Check if session is still active (may have been disposed during sleep)
          try {
            if (this.manager?.getSessionById(sessionId)?.isActive()) {
              session.write("\n");
            }
          } catch {
            // Session disposed, ignore
          }
        },
        onSessionId: (newSessionId) => {
          // Store the Claude session ID for future resume
          debug(`Storing Claude session ID for terminal ${sessionId}: ${newSessionId}`);
          aiContext.backendSessions["claude"] = newSessionId;
          currentClaudeSessionId = newSessionId;

          // Notify renderer that a Claude session ID was captured
          if (!this.disposed && this.window && !this.window.isDestroyed()) {
            this.window.webContents.send("terminal:claudeSessionChanged", {
              sessionId,
              claudeSessionId: newSessionId,
            });
          }
        },
        onToolCall: () => {},
      }
    );

    // Store handle reference for callbacks to access
    handleRef = handle;

    if (handle) {
      this.sessionAIActive.set(sessionId, handle);

      // Start loading animation after a brief delay (to avoid flicker for fast responses)
      setTimeout(() => {
        if (!headerShown && this.sessionAIActive.get(sessionId)) {
          this.startLoadingAnimation(sessionId);
        }
      }, 100);
    }
  }

  /**
   * Get display name for Claude Code (e.g., "Claude Code (haiku)")
   */
  private getBackendDisplayName(backend: DetectedBackend): string {
    const name = backend.config.name;

    // Extract model from args
    const args = backend.config.args;
    const modelIdx = args.indexOf("--model");
    if (modelIdx !== -1 && args[modelIdx + 1]) {
      return `${name} (${args[modelIdx + 1]})`;
    }

    return name;
  }

  /**
   * Resize terminal
   */
  resize(sessionId: string, cols: number, rows: number): { success: boolean; error?: string } {
    if (!this.manager) return { success: false, error: "No manager" };

    const session = this.manager.getSessionById(sessionId);
    if (!session || !session.isActive()) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    session.resize(cols, rows);
    return { success: true };
  }

  /**
   * Get terminal content
   */
  getContent(sessionId: string): {
    success: boolean;
    content?: string;
    cursor?: { x: number; y: number };
    dimensions?: { cols: number; rows: number };
    error?: string;
  } {
    if (!this.manager) return { success: false, error: "No manager" };

    const session = this.manager.getSessionById(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    const screenshot = session.takeScreenshot();
    return {
      success: true,
      content: screenshot.content,
      cursor: screenshot.cursor,
      dimensions: screenshot.dimensions,
    };
  }

  /**
   * Close terminal session
   */
  closeSession(sessionId: string): { success: boolean; error?: string } {
    if (!this.manager) return { success: false, error: "No manager" };

    // Clean up event handlers
    const handlers = this.sessionEventHandlers.get(sessionId);
    if (handlers) {
      handlers.cleanup();
      this.sessionEventHandlers.delete(sessionId);
    }

    // Clean up AI state for this session
    this.sessionLineBuffers.delete(sessionId);
    this.sessionAIActive.delete(sessionId);
    this.sessionAtPrompt.delete(sessionId);
    this.sessionAIContexts.delete(sessionId);
    this.sessionAutocomplete.delete(sessionId);
    this.sessionLastCommand.delete(sessionId);
    this.sessionLastTriageTime.delete(sessionId);
    this.sessionFastTracked.delete(sessionId);
    this.sessionFastTrackLines.delete(sessionId);
    this.stopLoadingAnimation(sessionId);

    // Cancel pending error triage
    const pendingTriage = this.sessionErrorTriage.get(sessionId);
    if (pendingTriage) {
      pendingTriage.cancel();
      this.sessionErrorTriage.delete(sessionId);
    }

    // Notify MCP server of session close (may trigger auto-reattach)
    if (this.mcpServer) {
      this.mcpServer.handleSessionClose(sessionId);
    }

    const closed = this.manager.closeSession(sessionId);
    return { success: closed, error: closed ? undefined : `Session not found: ${sessionId}` };
  }

  /**
   * Check if session is active
   */
  isActive(sessionId: string): boolean {
    if (!this.manager) return false;
    const session = this.manager.getSessionById(sessionId);
    return session?.isActive() ?? false;
  }

  /**
   * List all active sessions
   */
  listSessions(): { sessions: string[] } {
    if (!this.manager) return { sessions: [] };
    return { sessions: this.manager.getSessionIds() };
  }

  /**
   * Get the current foreground process for a session
   */
  getProcess(sessionId: string): { success: boolean; process?: string; error?: string } {
    if (!this.manager) return { success: false, error: "No manager" };

    const session = this.manager.getSessionById(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    try {
      const processName = session.getProcess();
      return {
        success: true,
        process: processName,
      };
    } catch {
      return { success: true, process: "shell" };
    }
  }

  /**
   * Get the current working directory of a terminal session
   */
  getCwd(sessionId: string): { success: boolean; cwd?: string; error?: string } {
    if (!this.manager) return { success: false, error: "No manager" };

    const session = this.manager.getSessionById(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    try {
      const cwd = session.getCwd();
      debug(`getCwd for ${sessionId}: ${cwd}`);
      if (cwd) {
        return { success: true, cwd };
      }
      return { success: false, error: "Could not determine cwd" };
    } catch (err) {
      debug(`getCwd error for ${sessionId}: ${err}`);
      return { success: false, error: "Failed to get cwd" };
    }
  }

  /**
   * Set sandbox mode configuration
   */
  async setSandboxMode(config: SandboxConfig): Promise<{ success: boolean; error?: string }> {
    debug("Setting sandbox mode with config:", config);
    this.sandboxConfig = config;
    this.useSandboxMode = true;

    // Convert SandboxConfig to SandboxPermissions format
    const permissions: SandboxPermissions = {
      filesystem: {
        readWrite: config.filesystem.readWrite,
        readOnly: config.filesystem.readOnly,
        blocked: config.filesystem.blocked,
      },
      network: {
        mode: config.network.mode,
        allowedDomains: config.network.allowedDomains,
      },
    };

    // Create and initialize sandbox controller
    this.sandboxController = new SandboxController();
    const status = await this.sandboxController.initialize(permissions);

    debug("Sandbox initialization status:", status);

    if (!status.enabled) {
      console.warn("[terminal-bridge] Sandbox not enabled:", status.reason);
      return {
        success: false,
        error: status.reason || "Failed to initialize sandbox",
      };
    }

    return { success: true };
  }

  /**
   * Start recording for a session
   */
  async startRecording(sessionId: string): Promise<{
    success: boolean;
    recordingId?: string;
    outputDir?: string;
    error?: string;
  }> {
    if (!this.manager) {
      return { success: false, error: "No manager" };
    }

    // Check if already recording this session
    if (this.sessionRecordings.has(sessionId)) {
      return { success: false, error: "Already recording this session" };
    }

    // Get the session to obtain dimensions
    const session = this.manager.getSessionById(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    try {
      const recordingManager = this.manager.getRecordingManager();
      const recorder = recordingManager.createRecording({ mode: 'always' });
      const recordingId = recorder.id;
      const outputDir = recordingManager.getDefaultOutputDir();

      // Get terminal dimensions and start the recording
      const dims = session.getDimensions();
      recorder.start(dims.cols, dims.rows, {
        SHELL: process.env.SHELL,
        TERM: process.env.TERM || 'xterm-256color',
      });

      // Store mapping
      this.sessionRecordings.set(sessionId, recordingId);

      // Notify renderer with outputDir
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:recordingChanged", {
          sessionId,
          isRecording: true,
          recordingId,
          outputDir,
        });
      }

      debug("Started recording for session:", sessionId, "recordingId:", recordingId);
      return { success: true, recordingId, outputDir };
    } catch (error) {
      console.error("[terminal-bridge] Failed to start recording:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Stop recording for a session
   */
  async stopRecording(
    sessionId: string,
    stopReason: 'explicit' | 'inactivity' | 'max_duration' = 'explicit'
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    if (!this.manager) {
      return { success: false, error: "No manager" };
    }

    const recordingId = this.sessionRecordings.get(sessionId);
    if (!recordingId) {
      return { success: false, error: "No recording for this session" };
    }

    try {
      const recordingManager = this.manager.getRecordingManager();
      const metadata = await recordingManager.finalizeRecording(recordingId, 0, stopReason);
      const outputDir = recordingManager.getDefaultOutputDir();

      // Remove mapping
      this.sessionRecordings.delete(sessionId);

      // Notify renderer with enhanced info
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:recordingChanged", {
          sessionId,
          isRecording: false,
          filePath: metadata?.path,
          outputDir,
          stopReason,
        });
      }

      debug("Stopped recording for session:", sessionId, "file:", metadata?.path);
      return { success: true, filePath: metadata?.path };
    } catch (error) {
      console.error("[terminal-bridge] Failed to stop recording:", error);

      // Remove mapping even on error to allow future recording attempts
      this.sessionRecordings.delete(sessionId);

      // Notify renderer of error
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:recordingChanged", {
          sessionId,
          isRecording: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get recording status for a session
   */
  getRecordingStatus(sessionId: string): { isRecording: boolean; recordingId?: string } {
    const recordingId = this.sessionRecordings.get(sessionId);
    return {
      isRecording: !!recordingId,
      recordingId: recordingId || undefined,
    };
  }

  /**
   * Open folder containing a recording
   */
  async openRecordingFolder(filePath: string): Promise<{ success: boolean }> {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      console.error("[terminal-bridge] Failed to open folder:", error);
      return { success: false };
    }
  }

  /**
   * List all recordings
   */
  async listRecordings(): Promise<{
    recordings: Array<{
      filename: string;
      filePath: string;
      size: number;
      createdAt: number;
      duration?: number;
    }>;
    outputDir: string;
  }> {
    const outputDir = this.getRecordingsDir();
    const recordings: Array<{
      filename: string;
      filePath: string;
      size: number;
      createdAt: number;
      duration?: number;
    }> = [];

    try {
      if (!fs.existsSync(outputDir)) {
        return { recordings, outputDir };
      }

      const files = fs.readdirSync(outputDir);
      const castFiles = files.filter((f) => f.endsWith('.cast'));

      for (const filename of castFiles) {
        const filePath = path.join(outputDir, filename);
        try {
          const stat = fs.statSync(filePath);
          const metaPath = filePath.replace(/\.cast$/, '.meta.json');

          let duration: number | undefined;
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              duration = meta.durationMs;
            } catch {
              // Ignore meta read errors
            }
          }

          recordings.push({
            filename,
            filePath,
            size: stat.size,
            createdAt: stat.birthtimeMs,
            duration,
          });
        } catch {
          // Skip files we can't stat
        }
      }

      // Sort by creation time, newest first
      recordings.sort((a, b) => b.createdAt - a.createdAt);

      // Return last 20 recordings
      return { recordings: recordings.slice(0, 20), outputDir };
    } catch (error) {
      console.error("[terminal-bridge] Failed to list recordings:", error);
      return { recordings, outputDir };
    }
  }

  /**
   * Delete a recording
   */
  async deleteRecording(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify the file is in our recordings directory
      const outputDir = this.getRecordingsDir();
      if (!filePath.startsWith(outputDir)) {
        return { success: false, error: "Invalid recording path" };
      }

      // Delete the recording file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Also delete the meta file if it exists
      const metaPath = filePath.replace(/\.cast$/, '.meta.json');
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
      }

      return { success: true };
    } catch (error) {
      console.error("[terminal-bridge] Failed to delete recording:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get recordings directory (public for index.ts)
   */
  getRecordingsDir(): string {
    // Match the path used in brosh's RecordingManager
    const xdgStateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
    return path.join(xdgStateHome, "brosh", "recordings");
  }

  /**
   * Open external URL in default browser (with protocol validation)
   */
  async openExternal(url: string): Promise<{ success: boolean; error?: string }> {
    try {
      const parsed = new URL(url);
      // Only allow http and https protocols for security
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: "Invalid protocol - only http and https are allowed" };
    } catch {
      return { success: false, error: "Invalid URL" };
    }
  }


  /**
   * Send error notification to renderer
   */
  private sendErrorNotification(
    sessionId: string,
    exitCode: number,
    command?: string | null,
    summary?: string
  ): void {
    debug(`sendErrorNotification: session=${sessionId}, exitCode=${exitCode}, command=${command}, summary=${summary}`);
    if (!this.disposed && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("terminal:message", {
        type: "error-detected",
        sessionId,
        exitCode,
        command: command || undefined,
        summary: summary || undefined,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle a fast-tracked command that failed (non-zero exit).
   * Re-classify the original input with ML — if it was NL, invoke AI retroactively.
   * If it was a real command that failed, fall through to normal error triage.
   */
  private async handleFailedFastTrack(
    session: ManagedSession,
    sessionId: string,
    exitCode: number
  ): Promise<void> {
    const lastCommand = this.sessionLastCommand.get(sessionId);
    if (!lastCommand) {
      // No command text — fall through to normal triage
      this.triageAndNotifyError(sessionId, exitCode);
      return;
    }

    // Check AI prerequisites
    if (!this.claudeCode) {
      this.triageAndNotifyError(sessionId, exitCode);
      return;
    }
    const settings = getSettings();
    const aiSettings = settings.ai || { enabled: true, confirmBeforeInvoking: false, showIndicator: true, denylist: '' };
    if (!aiSettings.enabled) {
      this.triageAndNotifyError(sessionId, exitCode);
      return;
    }

    // Re-classify with ML
    const result = await classifyInput(lastCommand);
    debug(`Fast-track re-classify: "${lastCommand.substring(0, 50)}..." -> ${result.classification} (${result.confidence.toFixed(2)})`);

    if (result.classification === "NATURAL_LANGUAGE" && result.confidence >= 0.7) {
      // It was actually NL — erase error output and invoke AI
      debug(`Fast-tracked command was NL, invoking AI retroactively`);
      const outputLines = this.sessionFastTrackLines.get(sessionId) || 0;
      if (outputLines > 1) {
        // Erase error output + new prompt, but keep the original prompt line.
        // outputLines includes the Enter-echo \n, so -1 lands on the first
        // error line rather than the original prompt.
        const linesToErase = outputLines - 1;
        this.writeToTerminalDisplay(
          sessionId,
          `\r\x1b[${linesToErase}A\x1b[J`
        );
        debug(`Erased ${linesToErase} lines of fast-track output`);
      }
      this.invokeAIForSession(session, sessionId, lastCommand, aiSettings);
    } else {
      // Real command that failed — normal error triage
      this.triageAndNotifyError(sessionId, exitCode);
    }
  }

  /**
   * Triage an error using AI and conditionally notify the renderer.
   *
   * Flow:
   * 1. Fast-skip signals (130=SIGINT, 143=SIGTERM)
   * 2. If Claude not installed or AI disabled → no badge
   * 3. Rate limit: skip if <3s since last triage for this session
   * 4. Get command text + last 30 lines of terminal output
   * 5. Spawn `claude -p --model haiku` for triage
   * 6. If shouldNotify → send error notification with summary
   * 7. If !shouldNotify or failure → no badge
   */
  private async triageAndNotifyError(sessionId: string, exitCode: number): Promise<void> {
    // Fast-skip: user-initiated signals
    if (exitCode === 130 || exitCode === 143) {
      debug(`triageAndNotifyError: skipping signal exit code ${exitCode}`);
      return;
    }

    // Check if Claude is installed and AI is enabled
    if (!this.claudeCode) {
      debug("triageAndNotifyError: Claude not installed, skipping");
      return;
    }

    const settings = getSettings();
    const aiSettings = settings.ai || { enabled: true, confirmBeforeInvoking: false, showIndicator: true, denylist: '' };
    if (!aiSettings.enabled) {
      debug("triageAndNotifyError: AI disabled in settings, skipping");
      return;
    }

    // Rate limit: skip if <3s since last triage for this session
    const now = Date.now();
    const lastTriageTime = this.sessionLastTriageTime.get(sessionId) || 0;
    if (now - lastTriageTime < 3000) {
      debug("triageAndNotifyError: rate limited, skipping");
      return;
    }
    this.sessionLastTriageTime.set(sessionId, now);

    // Cancel any pending triage for this session
    const pendingTriage = this.sessionErrorTriage.get(sessionId);
    if (pendingTriage) {
      pendingTriage.cancel();
      this.sessionErrorTriage.delete(sessionId);
    }

    // Get command text
    const command = this.sessionLastCommand.get(sessionId) || null;

    // Get last 30 lines of terminal output
    let recentOutput = "";
    try {
      const contentResult = this.getContent(sessionId);
      if (contentResult.success && contentResult.content) {
        const lines = contentResult.content.split("\n");
        recentOutput = lines.slice(-30).join("\n");
      }
    } catch {
      // Session may have been disposed
    }

    // Build prompt and spawn triage
    const prompt = buildTriagePrompt(command, exitCode, recentOutput);
    const sessionCwd = this.getCwd(sessionId);
    const cwd = sessionCwd.success && sessionCwd.cwd ? sessionCwd.cwd : undefined;

    const handle = triageError(this.claudeCode.path, prompt, cwd);
    this.sessionErrorTriage.set(sessionId, handle);

    try {
      const result = await handle.promise;
      // Clean up handle
      this.sessionErrorTriage.delete(sessionId);

      if (!result) {
        debug("triageAndNotifyError: triage returned null (failure/timeout), no badge");
        return;
      }

      if (result.shouldNotify) {
        debug(`triageAndNotifyError: notifying with summary: ${result.message}`);
        this.sendErrorNotification(sessionId, exitCode, command, result.message);
        // Report diagnostics to IDE protocol server for Claude Code
        this.ideProtocolServer?.updateDiagnostics(sessionId, {
          exitCode,
          command: command || "",
          summary: result.message,
          timestamp: Date.now(),
        });
      } else {
        debug(`triageAndNotifyError: suppressed (shouldNotify=false)`);
      }
    } catch (err) {
      debug(`triageAndNotifyError: error during triage: ${err}`);
      this.sessionErrorTriage.delete(sessionId);
    }
  }

  /**
   * Auto-dismiss error for a session (new command starting)
   */
  private autoDismissError(sessionId: string): void {
    if (!this.disposed && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("terminal:message", {
        type: "error-dismissed",
        sessionId,
      });
    }
    // Clear diagnostics from IDE protocol server
    this.ideProtocolServer?.clearDiagnostics(sessionId);
  }

  /**
   * Set up event forwarding for a session
   */
  private setupSessionEvents(session: ManagedSession, initialCwd?: string): void {
    const sessionId = session.id;
    let lastProcessName = session.getProcess();
    let lastOscTitle: string | null = null;
    let processCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    let cwdCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    // Resolve symlinks + strip trailing slash for consistent CWD comparison.
    // OSC 7 reports $PWD (may have symlinks), getCwd() uses lsof (resolves them).
    const normalizeCwd = (p: string): string => {
      try { p = fs.realpathSync(p); } catch { /* use as-is */ }
      return p.replace(/\/+$/, '') || '/';
    };

    // Initialize with the known CWD (passed from createSession) to avoid
    // an expensive getCwd() execSync (pgrep + lsof) on the startup path.
    let lastKnownCwd: string | null = initialCwd ? normalizeCwd(initialCwd) : null;

    // Debounced cwd check - fallback for shells without OSC 7 (e.g., bash)
    // Only spawns lsof after output settles, so it's not running on every keystroke
    // Skips when window is blurred or system is suspended to save battery
    const debouncedCwdCheck = () => {
      if (!this.windowFocused || this.systemSuspended) {
        return;
      }
      if (cwdCheckTimeout) {
        clearTimeout(cwdCheckTimeout);
      }
      cwdCheckTimeout = setTimeout(() => {
        try {
          if (!this.disposed && this.window && !this.window.isDestroyed()
              && this.windowFocused && !this.systemSuspended) {
            const rawCwd = session.getCwd();
            if (rawCwd) {
              const cwd = normalizeCwd(rawCwd);
              if (cwd !== lastKnownCwd) {
                lastKnownCwd = cwd;
                this.window.webContents.send("terminal:message", {
                  type: "cwd-changed",
                  sessionId,
                  cwd,
                });
              }
            }
          }
        } catch {
          // Session may have been disposed
        }
      }, 500);
    };

    // Forward output and detect process/title changes via OSC sequences
    // Note: Recording is handled by manager.ts via recordOutputToAll() - don't duplicate here
    session.onData((data) => {
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        const encoded = Buffer.from(data).toString("base64");

        // When display is off (system suspended / screen locked), buffer output
        // instead of sending IPC + triggering xterm.js rendering on an invisible canvas
        if (this.systemSuspended) {
          let buf = this.suspendedOutputBuffer.get(sessionId);
          if (!buf) {
            buf = [];
            this.suspendedOutputBuffer.set(sessionId, buf);
          }
          buf.push(encoded);
          return; // Skip all process/cwd/title checks too
        }

        this.window.webContents.send("terminal:message", {
          type: "output",
          sessionId,
          data: encoded,
        });

        // Count output lines for fast-tracked commands (for retroactive erasure)
        if (this.sessionFastTracked.get(sessionId)) {
          const lines = this.sessionFastTrackLines.get(sessionId) || 0;
          let newlines = 0;
          for (let i = 0; i < data.length; i++) {
            if (data[i] === '\n') newlines++;
          }
          if (newlines > 0) {
            this.sessionFastTrackLines.set(sessionId, lines + newlines);
          }
        }

        // Fast path: skip OSC parsing if no escape sequences present
        // OSC sequences start with ESC ] (\x1b])
        if (!data.includes('\x1b]')) {
          // No OSC sequences - skip title/notification/mark parsing
          // Still do debounced process check for non-OSC title changes
          if (processCheckTimeout) {
            clearTimeout(processCheckTimeout);
          }
          processCheckTimeout = setTimeout(() => {
            if (this.systemSuspended) return;
            try {
              const currentProcess = session.getProcess();
              if (currentProcess !== lastProcessName) {
                lastProcessName = currentProcess;
                this.window.webContents.send("terminal:message", {
                  type: "process-changed",
                  sessionId,
                  process: currentProcess,
                });
              }
            } catch {
              // Session may have been disposed
            }
          }, 100);
          // Fallback cwd check for shells without OSC 7
          debouncedCwdCheck();
          return;
        }

        // Check for OSC title sequences (shells emit these to set window title)
        const oscTitle = parseOscTitle(data);
        if (oscTitle !== null && oscTitle !== lastOscTitle) {
          lastOscTitle = oscTitle;

          // Only send title changes for useful titles (process names, AI status, etc.)
          // Directory-based titles (user@host:path) are filtered out
          if (isUsefulTitle(oscTitle)) {
            this.window.webContents.send("terminal:message", {
              type: "title-changed",
              sessionId,
              title: oscTitle,
            });
          } else {
            // Shell-style title detected - clear any previous application title
            // This resets the UI to show just the process name
            this.window.webContents.send("terminal:message", {
              type: "title-changed",
              sessionId,
              title: undefined, // Clear the title
            });
          }

          // Also check for process changes via PTY
          // The process name is always derived from the actual PTY process
          if (processCheckTimeout) {
            clearTimeout(processCheckTimeout);
          }
          processCheckTimeout = setTimeout(() => {
            if (this.systemSuspended) return;
            try {
              const currentProcess = session.getProcess();
              if (currentProcess !== lastProcessName) {
                lastProcessName = currentProcess;
                this.window.webContents.send("terminal:message", {
                  type: "process-changed",
                  sessionId,
                  process: currentProcess,
                });
              }
            } catch {
              // Session may have been disposed
            }
          }, 50);
        } else if (oscTitle === null) {
          // No OSC sequence in this output chunk - debounced fallback check
          // This catches cases where the shell doesn't set OSC titles
          if (processCheckTimeout) {
            clearTimeout(processCheckTimeout);
          }
          processCheckTimeout = setTimeout(() => {
            if (this.systemSuspended) return;
            try {
              const currentProcess = session.getProcess();
              if (currentProcess !== lastProcessName) {
                lastProcessName = currentProcess;
                this.window.webContents.send("terminal:message", {
                  type: "process-changed",
                  sessionId,
                  process: currentProcess,
                });
              }
            } catch {
              // Session may have been disposed
            }
          }, 100);
        }

        // Check for OSC 9/777 notification sequences
        const notification = parseOscNotification(data);
        // Skip bodies that are clearly not user-facing text (e.g. "4;0;", "4;3;")
        // These are likely OSC parameter fragments from terminal apps, not real notifications.
        const hasText = notification && /[a-zA-Z]/.test(notification.body);
        if (hasText && Notification.isSupported()) {
          // Only show notification when window is not focused
          if (!this.window.isFocused()) {
            const n = new Notification({
              title: notification!.title || 'Terminal',
              body: notification!.body,
              silent: false,
            });
            n.on('click', () => {
              // Focus the window when notification is clicked
              this.window.show();
              this.window.focus();
            });
            n.show();
          }
        }

        // Check for OSC 133 shell integration sequences
        const marks = parseOsc133(data);
        if (marks.length > 0) {
          for (const mark of marks) {
            debug(`OSC 133 mark: ${mark.type}${mark.exitCode !== undefined ? ` (exit ${mark.exitCode})` : ''} [${sessionId}]`);
            this.window.webContents.send("terminal:message", {
              type: "command-mark",
              sessionId,
              mark,
            });

            // Error detection via exit codes (skip 126=not executable, 127=command not found)
            if (mark.type === 'command-end' && mark.exitCode !== undefined && mark.exitCode !== 0
                && mark.exitCode !== 126 && mark.exitCode !== 127) {
              if (this.sessionFastTracked.get(sessionId)) {
                // Fast-tracked command failed — retroactive ML check
                this.handleFailedFastTrack(session, sessionId, mark.exitCode);
              } else {
                this.triageAndNotifyError(sessionId, mark.exitCode);
              }
            } else if (mark.type === 'output-start') {
              // New command starting — cancel pending triage + auto-dismiss previous error
              const pendingTriage = this.sessionErrorTriage.get(sessionId);
              if (pendingTriage) {
                pendingTriage.cancel();
                this.sessionErrorTriage.delete(sessionId);
              }
              this.autoDismissError(sessionId);
            }
          }
        }

        // Check for OSC 7 directory change sequences
        // Shells emit this when cwd changes (more efficient than polling)
        const rawOscCwd = parseOsc7(data);
        if (rawOscCwd) {
          const newCwd = normalizeCwd(rawOscCwd);
          if (newCwd !== lastKnownCwd) {
            lastKnownCwd = newCwd;
            this.window.webContents.send("terminal:message", {
              type: "cwd-changed",
              sessionId,
              cwd: newCwd,
            });
          }
        } else {
          // No OSC 7 in this chunk - use debounced fallback
          debouncedCwdCheck();
        }
      }
    });

    // Forward exit
    session.onExit((code) => {
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:message", {
          type: "session-closed",
          sessionId,
          exitCode: code,
        });
      }
      this.sessionEventHandlers.delete(sessionId);

      // Notify MCP server of session close (may trigger auto-reattach)
      if (this.mcpServer) {
        this.mcpServer.handleSessionClose(sessionId);
      }
    });

    // Forward resize
    // Note: Recording is handled by manager.ts via recordResizeToAll() - don't duplicate here
    session.onResize((cols, rows) => {
      if (!this.disposed && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("terminal:message", {
          type: "resize",
          sessionId,
          cols,
          rows,
        });
      }
    });

    // Store cleanup function (for when session is manually closed)
    this.sessionEventHandlers.set(sessionId, {
      cleanup: () => {
        // Session event handlers are automatically cleaned up when session is disposed
      },
    });
  }

  /**
   * Register callback for when manager is ready
   */
  onManagerReady(callback: (manager: TerminalManager) => void): void {
    if (this.manager) {
      // Manager already exists, call immediately
      callback(this.manager);
    } else {
      this.managerReadyCallbacks.push(callback);
    }
  }

  /**
   * Get the terminal manager (if ready)
   */
  getManager(): TerminalManager | null {
    return this.manager;
  }

  /**
   * Set the MCP server reference (for session attachment coordination)
   */
  setMcpServer(mcpServer: McpServer): void {
    this.mcpServer = mcpServer;
  }

  /**
   * Set the IDE protocol server reference (for diagnostics reporting)
   */
  setIdeProtocolServer(ideProtocolServer: IdeProtocolServer): void {
    this.ideProtocolServer = ideProtocolServer;
  }

  /**
   * Set window focus state for battery optimization
   * When window is blurred, pause CPU-intensive animations
   */
  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
    if (!focused) {
      // Pause AI spinners when window loses focus to save CPU
      for (const spinner of this.sessionAISpinner.values()) {
        clearInterval(spinner.timer);
      }
    } else if (!this.systemSuspended) {
      // Resume spinners for active AI sessions when window regains focus
      for (const sessionId of this.sessionAIActive.keys()) {
        if (!this.sessionAISpinner.has(sessionId)) {
          this.startLoadingAnimation(sessionId);
        }
      }
    }
  }

  /**
   * Handle system suspend (sleep) - pause all timers and activities
   */
  handleSystemSuspend(): void {
    this.systemSuspended = true;
    // Stop all AI spinners during system sleep
    for (const spinner of this.sessionAISpinner.values()) {
      clearInterval(spinner.timer);
    }
  }

  /**
   * Handle system resume (wake) - restart activities if window is focused
   */
  handleSystemResume(): void {
    this.systemSuspended = false;

    // Flush buffered PTY output accumulated during display sleep
    if (this.suspendedOutputBuffer.size > 0 && !this.disposed && this.window && !this.window.isDestroyed()) {
      for (const [sessionId, chunks] of this.suspendedOutputBuffer) {
        if (chunks.length > 0) {
          // Concatenate all buffered chunks into a single IPC message
          const combined = Buffer.concat(chunks.map(b64 => Buffer.from(b64, "base64")));
          this.window.webContents.send("terminal:message", {
            type: "output",
            sessionId,
            data: combined.toString("base64"),
          });
        }
      }
      this.suspendedOutputBuffer.clear();
    }

    if (this.windowFocused) {
      // Resume spinners for active AI sessions
      for (const sessionId of this.sessionAIActive.keys()) {
        if (!this.sessionAISpinner.has(sessionId)) {
          this.startLoadingAnimation(sessionId);
        }
      }
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.disposed = true;

    // Discard unconsumed speculative session
    if (this.speculativeSession) {
      this.speculativeSession.consumed = true;
      this.speculativeSession = null;
    }

    // Discard any buffered output (no point flushing to a closing window)
    this.suspendedOutputBuffer.clear();

    // Note: IPC handlers are registered globally in index.ts, not here

    // Clean up GUI stream
    if (this.clientId) {
      this.guiStream.removeClient(this.clientId);
    }
    this.guiStream.dispose();

    // Cancel all pending error triages
    for (const handle of this.sessionErrorTriage.values()) {
      handle.cancel();
    }
    this.sessionErrorTriage.clear();

    // Clean up manager
    if (this.manager) {
      this.manager.dispose();
      this.manager = null;
    }

    // Clean up sandbox controller
    if (this.sandboxController) {
      this.sandboxController.cleanup().catch(console.error);
      this.sandboxController = null;
    }

  }
}
