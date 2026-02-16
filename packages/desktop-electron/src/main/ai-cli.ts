/**
 * AI CLI Integration Module
 *
 * Handles detection and invocation of local AI CLI tools.
 * Supports configurable backends: claude, gh copilot, llm, ollama, etc.
 */

import { spawn, execSync } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Debug logging
const debug = (msg: string, ...args: unknown[]) => {
  console.log(`[ai-cli] ${msg}`, ...args);
};

/**
 * AI CLI backend configuration
 */
export interface AIBackendConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  checkCommand: string;
  streamOutput: boolean;
  /** Whether this backend supports a system prompt */
  supportsSystemPrompt: boolean;
  /** How to pass the system prompt (if supported) */
  systemPromptArg?: string;
  /** Environment variable for system prompt (alternative to arg) */
  systemPromptEnv?: string;
  /** Output format: 'text' (default), 'stream-json' for Claude/Gemini, 'json' for Codex */
  outputFormat?: "text" | "stream-json" | "json";
  /** Whether this backend supports session resume */
  supportsSessionResume?: boolean;
  /** How to pass the resume argument: 'flag' adds --resume <id>, 'subcommand' inserts resume <id> before prompt */
  resumeMode?: "flag" | "subcommand";
}

/**
 * Claude Code CLI configuration
 *
 * This is the only supported backend because:
 * - Uses your existing Claude Pro/Max subscription (no extra API costs)
 * - Has actual tool execution (can run commands, read/write files)
 * - Streams output cleanly with structured JSON
 * - Supports session resume for follow-up conversations
 */
export const CLAUDE_CODE_CONFIG: AIBackendConfig = {
  id: "claude",
  name: "Claude Code",
  command: "claude",
  args: ["-p", "--model", "haiku", "--output-format", "stream-json", "--verbose"],
  checkCommand: "which claude",
  streamOutput: true,
  supportsSystemPrompt: true,
  systemPromptArg: "--append-system-prompt",
  outputFormat: "stream-json",
  supportsSessionResume: true,
  resumeMode: "flag",
};

/**
 * Detected AI CLI with its configuration
 */
export interface DetectedBackend {
  config: AIBackendConfig;
  path: string;
  version?: string;
}

/**
 * Check if a backend is installed
 */
function isBackendInstalled(config: AIBackendConfig): string | null {
  // When launched as a macOS GUI app (Finder/Spotlight), PATH is minimal
  // (/usr/bin:/bin:/usr/sbin:/sbin) and won't include ~/.local/bin etc.
  // Check well-known install locations first before falling back to `which`.
  const knownPaths = [
    path.join(os.homedir(), ".local", "bin", config.command),
    `/usr/local/bin/${config.command}`,
    path.join(os.homedir(), ".npm-global", "bin", config.command),
  ];

  for (const candidate of knownPaths) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found here, try next
    }
  }

  // Fall back to `which` (works when launched from terminal with full PATH)
  try {
    const result = execSync(config.checkCommand, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (config.checkCommand.startsWith("which ")) {
      return result.trim();
    }

    try {
      const pathResult = execSync(`which ${config.command}`, {
        encoding: "utf-8",
        timeout: 2000,
      });
      return pathResult.trim();
    } catch {
      return config.command;
    }
  } catch {
    return null;
  }
}

/**
 * Get version string for a backend (optional, for display)
 */
function getBackendVersion(config: AIBackendConfig, cmdPath: string): string | undefined {
  try {
    // Try common version flags
    for (const flag of ["--version", "-V", "-v", "version"]) {
      try {
        const result = execSync(`${cmdPath} ${flag}`, {
          encoding: "utf-8",
          timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        // Extract first line or version number
        const firstLine = result.split("\n")[0].trim();
        if (firstLine) {
          return firstLine;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Version detection is optional
  }
  return undefined;
}

/**
 * Check if Claude Code CLI is installed
 */
export function detectClaudeCode(): DetectedBackend | null {
  const cmdPath = isBackendInstalled(CLAUDE_CODE_CONFIG);
  if (cmdPath) {
    const backend = {
      config: CLAUDE_CODE_CONFIG,
      path: cmdPath,
      version: getBackendVersion(CLAUDE_CODE_CONFIG, cmdPath),
    };
    debug(`Found ${CLAUDE_CODE_CONFIG.name} at ${cmdPath}`);
    return backend;
  }
  debug("Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code");
  return null;
}

/**
 * AI CLI settings stored by the user
 */
export interface AISettings {
  enabled: boolean;
  confirmBeforeInvoking: boolean;
  showIndicator: boolean;
  denylist: string[]; // commands to never interpret as NL
}

/**
 * Default AI settings
 */
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  confirmBeforeInvoking: false,
  showIndicator: true,
  denylist: [],
};

/**
 * Claude Code CLI status including installation and authentication
 */
export interface ClaudeStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  model?: string;
}

/**
 * Available Claude models
 */
export type ClaudeModel = "haiku" | "sonnet" | "opus";

/**
 * Check if Claude Code CLI is authenticated
 *
 * Claude Code uses macOS Keychain for OAuth tokens, so we can't easily check.
 * If Claude is installed and can run, we assume it's authenticated.
 * If not authenticated, Claude Code itself will prompt for login when used.
 */
function checkClaudeAuthentication(claudePath: string): boolean {
  try {
    // If we can get the version, Claude is set up and likely authenticated
    execSync(`${claudePath} --version`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get comprehensive Claude Code CLI status
 */
export function getClaudeStatus(): ClaudeStatus {
  const claudeCode = detectClaudeCode();
  if (!claudeCode) {
    return { installed: false, authenticated: false };
  }

  const authenticated = checkClaudeAuthentication(claudeCode.path);

  // Get current model from config
  const modelIdx = CLAUDE_CODE_CONFIG.args.indexOf("--model");
  const model = modelIdx !== -1 ? CLAUDE_CODE_CONFIG.args[modelIdx + 1] : "haiku";

  return {
    installed: true,
    authenticated,
    version: claudeCode.version,
    model,
  };
}

/**
 * Update the Claude model in the config
 */
export function setClaudeModel(model: ClaudeModel): void {
  const args = CLAUDE_CODE_CONFIG.args;
  const modelIdx = args.indexOf("--model");
  if (modelIdx !== -1) {
    args[modelIdx + 1] = model;
  }
}

/**
 * Get the system prompt for AI context
 */
export function buildSystemPrompt(context: {
  cwd?: string;
  shell?: string;
  platform?: string;
}): string {
  const { cwd } = context;

  return `You are a terminal assistant. Current directory: ${cwd || process.cwd()}

Rules:
- Do exactly what is asked, nothing more
- No explanations unless asked
- No commentary or opinions
- Just output the result`;
}

/**
 * AI tool call information (for file timeline tracking)
 */
export interface AiToolCall {
  id: string;
  name: string;       // "Write" | "Edit" | etc.
  filePath?: string;  // For file-modifying tools
  timestamp: number;
}

/**
 * Invoke Claude Code CLI with the user's query
 *
 * Returns a handle to cancel the request, or null if Claude Code is not installed.
 */
export function invokeAI(
  query: string,
  claudeCode: DetectedBackend | null,
  context: {
    cwd?: string;
    shell?: string;
    sessionId?: string; // Claude session ID for resume
    onData: (data: string) => void;
    onError: (error: string) => void;
    onEnd: (exitCode: number) => void;
    onSessionId?: (sessionId: string) => void; // Called when session ID is discovered
    onToolCall?: (call: AiToolCall) => void;   // Called when Write/Edit tools are invoked
  }
): { cancel: () => void; backend: DetectedBackend } | null {
  if (!claudeCode) {
    context.onError("Claude Code CLI not installed. Install it with: npm install -g @anthropic-ai/claude-code");
    context.onEnd(1);
    return null;
  }

  const backend = claudeCode;

  const { config, path: cmdPath } = backend;
  const systemPrompt = buildSystemPrompt({
    cwd: context.cwd,
    shell: context.shell,
    platform: process.platform,
  });

  // Build command arguments
  const args = [...config.args];

  // Add session resume if supported and session ID provided
  if (config.supportsSessionResume && context.sessionId) {
    if (config.resumeMode === "subcommand") {
      // Codex style: insert "resume <session_id>" after base subcommand
      // e.g., "codex exec resume <id> prompt" instead of "codex exec prompt"
      args.push("resume", context.sessionId);
      debug(`Resuming ${config.name} session (subcommand): ${context.sessionId}`);
    } else {
      // Flag style (default): add --resume <session_id>
      args.push("--resume", context.sessionId);
      debug(`Resuming ${config.name} session (flag): ${context.sessionId}`);
    }
  }

  // Add system prompt if supported
  if (config.supportsSystemPrompt && config.systemPromptArg) {
    args.push(config.systemPromptArg, systemPrompt);
  }

  // Add the query
  args.push(query);

  debug(`Invoking: ${cmdPath} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);

  // Spawn the AI CLI
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  // Add system prompt via env if that's how the backend expects it
  if (config.supportsSystemPrompt && config.systemPromptEnv) {
    env[config.systemPromptEnv] = systemPrompt;
  }

  const proc = spawn(cmdPath, args, {
    cwd: context.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Close stdin to signal no more input
  proc.stdin.end();

  debug(`Process spawned with PID: ${proc.pid}`);

  // Track if we've captured the session ID (only capture once)
  let sessionIdCaptured = false;

  // Buffer for incomplete JSON lines (stream may split lines)
  let jsonBuffer = "";

  // Full output buffer for non-streaming JSON (Codex)
  let fullOutputBuffer = "";

  /**
   * Extract session ID from a JSON object (various formats)
   */
  const extractSessionId = (obj: Record<string, unknown>): string | null => {
    // Claude/Gemini: session_id at top level
    if (typeof obj.session_id === "string") return obj.session_id;
    // Codex: might be in metadata or result
    if (typeof obj.sessionId === "string") return obj.sessionId;
    if (obj.metadata && typeof (obj.metadata as Record<string, unknown>).sessionId === "string") {
      return (obj.metadata as Record<string, unknown>).sessionId as string;
    }
    return null;
  };

  /**
   * Extract text content from a JSON object (various formats)
   * Uses exclusive format detection to avoid duplication
   */
  const extractTextContent = (obj: Record<string, unknown>): string => {
    // Skip Claude "result" type - it duplicates the content from "assistant" message
    if (obj.type === "result") {
      return "";
    }

    // Skip Claude "system" type - init/setup messages, not content
    if (obj.type === "system") {
      return "";
    }

    // Claude format: type="assistant" with message.content[].text
    // This is the ONLY format we should use for Claude Code CLI
    if (obj.type === "assistant" && obj.message) {
      const message = obj.message as Record<string, unknown>;
      if (Array.isArray(message.content)) {
        let text = "";
        for (const block of message.content) {
          if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
            const blockText = (block as Record<string, unknown>).text;
            if (typeof blockText === "string") text += blockText;
          }
        }
        return text; // Return early - don't check other formats
      }
    }

    // Gemini event format: text in message events
    if (obj.type === "message" && typeof obj.text === "string") {
      return obj.text;
    }

    // Gemini format: response field
    if (typeof obj.response === "string") {
      return obj.response;
    }

    // Codex format: output or result field (but NOT Claude's result type, already filtered above)
    if (typeof obj.output === "string") {
      return obj.output;
    }

    // Last resort: standalone content field (only if no other format matched)
    if (typeof obj.content === "string") {
      return obj.content;
    }

    return "";
  };

  /**
   * Extract tool_use blocks from Claude's message.content array
   * Only emits for file-modifying tools (Write, Edit)
   */
  const extractToolCalls = (obj: Record<string, unknown>): void => {
    if (obj.type !== "assistant" || !obj.message) return;

    const message = obj.message as Record<string, unknown>;
    if (!Array.isArray(message.content)) return;

    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;

      const b = block as Record<string, unknown>;
      if (b.type !== "tool_use" || typeof b.name !== "string") continue;

      // Only emit for file-modifying tools
      if (!["Write", "Edit"].includes(b.name)) continue;

      const input = b.input as Record<string, unknown> | undefined;
      // Claude uses file_path for both Write and Edit tools
      const filePath = (input?.file_path ?? input?.path) as string | undefined;

      if (filePath && typeof b.id === "string") {
        debug(`Tool call: ${b.name} on ${filePath}`);
        context.onToolCall?.({
          id: b.id,
          name: b.name,
          filePath,
          timestamp: Date.now(),
        });
      }
    }
  };

  /**
   * Parse stream-json output (JSONL format)
   * Used by Claude and Gemini
   */
  const parseStreamJson = (chunk: string): string => {
    // Add to buffer
    jsonBuffer += chunk;

    // Split by newlines and process complete lines
    const lines = jsonBuffer.split("\n");
    // Keep the last potentially incomplete line in the buffer
    jsonBuffer = lines.pop() || "";

    let textOutput = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;

        // Extract session ID
        if (!sessionIdCaptured) {
          const sessionId = extractSessionId(obj);
          if (sessionId) {
            sessionIdCaptured = true;
            debug(`Captured ${config.name} session ID: ${sessionId}`);
            context.onSessionId?.(sessionId);
          }
        }

        // Extract tool_use blocks (for file timeline tracking)
        extractToolCalls(obj);

        // Extract text content
        const extracted = extractTextContent(obj);
        if (extracted) {
          debug(`Extracted text from type="${obj.type}": "${extracted.substring(0, 50)}..."`);
        }
        textOutput += extracted;
      } catch {
        // Not valid JSON - might be raw text output, pass through
        debug(`Non-JSON line: ${trimmed.substring(0, 100)}`);
      }
    }

    return textOutput;
  };

  /**
   * Parse single JSON output (Codex format)
   * Called when process ends to parse accumulated buffer
   */
  const parseJsonOutput = (fullOutput: string): string => {
    try {
      const obj = JSON.parse(fullOutput.trim()) as Record<string, unknown>;

      // Extract session ID
      if (!sessionIdCaptured) {
        const sessionId = extractSessionId(obj);
        if (sessionId) {
          sessionIdCaptured = true;
          debug(`Captured ${config.name} session ID: ${sessionId}`);
          context.onSessionId?.(sessionId);
        }
      }

      // Extract text content
      return extractTextContent(obj);
    } catch {
      debug(`Failed to parse JSON output: ${fullOutput.substring(0, 200)}`);
      // Return raw output as fallback
      return fullOutput;
    }
  };

  // Handle stdout
  proc.stdout.on("data", (data: Buffer) => {
    const str = data.toString();
    debug(`stdout: ${str.substring(0, 200)}${str.length > 200 ? '...' : ''}`);

    if (config.outputFormat === "stream-json") {
      // Parse JSONL and extract text content incrementally
      const text = parseStreamJson(str);
      if (text) {
        context.onData(text);
      }
    } else if (config.outputFormat === "json") {
      // Accumulate for single JSON parsing at end
      fullOutputBuffer += str;
    } else {
      // Raw text output
      context.onData(str);
    }
  });

  // Handle stderr (some CLIs write progress to stderr)
  proc.stderr.on("data", (data: Buffer) => {
    const str = data.toString();
    debug(`stderr: ${str.substring(0, 200)}${str.length > 200 ? '...' : ''}`);
    // Some CLIs use stderr for progress indicators, others for errors
    // For json/stream-json mode, stderr is typically progress/status, not content
    // Don't pass stderr through for structured output backends
    if (config.outputFormat !== "stream-json" && config.outputFormat !== "json") {
      context.onData(str);
    }
  });

  // Handle close
  proc.on("close", (code) => {
    debug(`Process closed with code: ${code}`);

    // For single JSON output (Codex), parse the accumulated buffer now
    if (config.outputFormat === "json" && fullOutputBuffer) {
      const text = parseJsonOutput(fullOutputBuffer);
      if (text) {
        context.onData(text);
      }
    }

    context.onEnd(code ?? 0);
  });

  // Handle errors
  proc.on("error", (err) => {
    debug(`Process error: ${err.message}`);
    context.onError(`Failed to start AI CLI: ${err.message}`);
    context.onEnd(1);
  });

  // Return cancel function and backend info
  return {
    cancel: () => {
      proc.kill("SIGTERM");
    },
    backend,
  };
}

/**
 * Format AI response for terminal display
 *
 * Adds visual indicators and styling.
 *
 * @param text - The response text content
 * @param isStart - Whether this is the start of the response
 * @param isEnd - Whether this is the end of the response
 * @param backendName - Display name of the AI backend (e.g., "Claude Code (haiku)")
 * @param elapsedMs - Elapsed time in milliseconds (for end display)
 * @param sessionId - Claude session ID (shown in header)
 * @param isFirstMessage - Whether this is the first message in a new session
 */
export function formatAIResponse(
  text: string,
  isStart: boolean,
  isEnd: boolean,
  backendName?: string,
  elapsedMs?: number,
  sessionId?: string,
  isFirstMessage?: boolean
): string {
  let output = "";

  if (isStart) {
    // AI indicator with backend name and session ID at start
    const displayName = backendName || "AI";
    const sessionStr = sessionId ? ` \x1b[38;5;240m[${sessionId.substring(0, 8)}]\x1b[0m` : "";
    // Use Claude's stylized asterisk logo (✦) instead of robot emoji
    output += `\r\n\x1b[38;5;141m\x1b[1m✦ ${displayName}\x1b[0m${sessionStr}\x1b[38;5;240m ─────────────────────────────\x1b[0m\r\n`;

    // Show resume instructions only for NEW sessions (not when continuing an existing one)
    if (isFirstMessage && sessionId) {
      output += `\x1b[38;5;240m   Resume this session in CLI: claude --resume ${sessionId}\x1b[0m\r\n`;
    }

    output += `\r\n`;
  }

  // The actual response text (already formatted by the AI CLI)
  output += text;

  if (isEnd) {
    // Separator with optional timing at end
    const timeStr = elapsedMs !== undefined ? ` (${(elapsedMs / 1000).toFixed(1)}s)` : "";
    output += `\r\n\x1b[38;5;240m──────────────────────────────────────────────${timeStr}\x1b[0m\r\n`;
  }

  return output;
}
