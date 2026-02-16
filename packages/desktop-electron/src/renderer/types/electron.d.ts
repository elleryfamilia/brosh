/**
 * Type declarations for Electron preload API
 */

import type { AppSettings, SettingsUpdate, ClaudeModel } from '../settings/types';

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
  manualRequired?: boolean;
}

export interface SandboxConfig {
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

export interface TerminalAPI {
  // Session management
  createSession: (options?: {
    cols?: number;
    rows?: number;
    shell?: string;
    cwd?: string;
  }) => Promise<{
    success: boolean;
    sessionId?: string;
    cols?: number;
    rows?: number;
    error?: string;
  }>;

  closeSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;

  isActive: (sessionId: string) => Promise<boolean>;

  listSessions: () => Promise<{ sessions: string[] }>;

  // Terminal I/O
  input: (sessionId: string, data: string) => Promise<{ success: boolean; error?: string }>;

  resize: (
    sessionId: string,
    cols: number,
    rows: number
  ) => Promise<{ success: boolean; error?: string }>;

  getContent: (sessionId: string) => Promise<{
    success: boolean;
    content?: string;
    cursor?: { x: number; y: number };
    dimensions?: { cols: number; rows: number };
    error?: string;
  }>;

  getProcess: (sessionId: string) => Promise<{
    success: boolean;
    process?: string;
    error?: string;
  }>;

  getCwd: (sessionId: string) => Promise<{
    success: boolean;
    cwd?: string;
    error?: string;
  }>;
  getHomedir: () => Promise<string>;

  // Event listeners
  onMessage: (callback: (message: unknown) => void) => () => void;
  onWindowResize: (callback: () => void) => () => void;

  // MCP server
  mcpGetStatus: () => Promise<McpStatus>;
  mcpStart: () => Promise<McpStatus>;
  mcpStop: () => Promise<McpStatus>;
  onMcpStatusChanged: (callback: (status: McpStatus) => void) => () => void;

  // MCP session attachment
  mcpAttach: (sessionId: string) => Promise<boolean>;
  mcpDetach: () => Promise<boolean>;
  mcpGetAttached: () => Promise<string | null>;
  mcpGetClients: () => Promise<TrackedClient[]>;
  onMcpAttachmentChanged: (callback: (data: McpAttachmentChange) => void) => () => void;
  onMcpToolCallStarted: (callback: (data: McpToolCallStarted) => void) => () => void;
  onMcpToolCallCompleted: (callback: (data: McpToolCallCompleted) => void) => () => void;
  onMcpClientConnected: (callback: (data: McpClientConnected) => void) => () => void;
  onMcpClientDisconnected: (callback: (data: McpClientDisconnected) => void) => () => void;
  mcpDisconnectClient: (clientId: string) => Promise<boolean>;
  onMcpSocketLost: (callback: (data: McpSocketLost) => void) => () => void;

  // Sandbox mode
  setSandboxMode: (config: SandboxConfig) => Promise<void>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  updateSettings: (updates: SettingsUpdate) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  setWindowOpacity: (opacity: number) => Promise<boolean>;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;

  // Real-time input mode feedback
  onInputModeChanged: (callback: (data: InputModeChange) => void) => () => void;

  // Typo suggestion feedback (shown after Enter when typo detected)
  onTypoSuggestion: (callback: (data: TypoSuggestionChange) => void) => () => void;

  // Autocomplete suggestion feedback (shown while typing)
  onAutocomplete: (callback: (data: AutocompleteChange) => void) => () => void;

  // Menu events
  onMenuPreferences: (callback: () => void) => () => void;

  // Window management
  createWindow: () => Promise<{ success: boolean }>;

  // Claude Code status
  getClaudeStatus: () => Promise<ClaudeStatus>;
  setClaudeModel: (model: ClaudeModel) => Promise<{ success: boolean }>;
  getClaudeSessionId: (terminalSessionId: string) => Promise<string | null>;
  onClaudeSessionChanged: (callback: (data: ClaudeSessionChange) => void) => () => void;

  // Shell utilities
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

  // File utilities
  getPathForFile: (file: File) => string;

  // File reading (for editor pane)
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  statFile: (filePath: string) => Promise<{
    success: boolean;
    stat?: { size: number; isFile: boolean; isDirectory: boolean; mtime: string };
    error?: string;
  }>;
  gitShowFile: (filePath: string, ref?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  gitListMarkdownFiles: (cwd?: string) => Promise<{ success: boolean; files: string[]; root: string | null }>;
  discoverMemoryFiles: (cwd?: string) => Promise<{ success: boolean; files: MemoryFileInfo[] }>;

  // Git status
  getGitStatus: (cwd?: string) => Promise<GitStatusResult | null>;
  onGitChanged: (callback: () => void) => () => void;

  // Git root
  getGitRoot: (cwd?: string) => Promise<{ success: boolean; root: string | null }>;

  // Git commits
  getGitCommits: (cwd?: string, count?: number) => Promise<GitCommitResult[] | null>;

  // Auto-updater
  updaterCheck: () => Promise<UpdateStatus>;
  updaterDownload: () => Promise<void>;
  updaterInstall: () => void;
  updaterGetStatus: () => Promise<UpdateStatus>;
  onUpdaterStatus: (callback: (status: UpdateStatus) => void) => () => void;

  // IDE Protocol
  ideRestart: (cwd?: string) => Promise<{ success: boolean; error?: string }>;
  ideUpdateWorkspaceFolders: (cwd?: string) => Promise<{ success: boolean; error?: string }>;
  ideReportSelection: (sessionId: string, text: string) => Promise<void>;
  ideReportFileOpen: (filePath: string) => Promise<void>;
  onIdeRequestSelection: (callback: (requestId: string) => void) => () => void;
  ideSelectionResponse: (requestId: string, sessionId: string, text: string) => void;
  onIdeOpenFile: (callback: (data: { filePath: string }) => void) => () => void;
  onIdeOpenDiff: (callback: (data: { oldContent: string; newContent: string; filePath: string }) => void) => () => void;
  ideAddFragment: (sessionId: string, text: string) => Promise<void>;
  ideRemoveFragment: (index: number) => Promise<void>;
  ideClearFragments: () => Promise<void>;
  onIdeFragmentsChanged: (callback: (data: { fragments: Array<{ index: number; sessionId: string; preview: string; lineCount: number }> }) => void) => () => void;

  // Claude Code info
  claudeGetInfo: () => Promise<{ model: string | null; version: string | null }>;
  onClaudeInfoChanged: (callback: (data: { model: string | null; version: string | null }) => void) => () => void;
  onIdeClientDisconnected: (callback: (data: { code: number }) => void) => () => void;

  // Analytics
  analyticsGetConsent: () => Promise<boolean>;
  analyticsSetConsent: (enabled: boolean) => Promise<{ success: boolean }>;
  analyticsHasSeenWelcome: () => Promise<boolean>;
  analyticsMarkWelcomeSeen: () => Promise<{ success: boolean }>;
  analyticsTrack: (event: string, properties?: Record<string, unknown>) => Promise<{ success: boolean }>;
  analyticsSubmitFeedback: (category: string, message: string, email?: string) => Promise<{ success: boolean; error?: string }>;

  // Plans
  getPlansForProject: (gitRoot: string) => Promise<PlanFileInfo[]>;
  indexPlansForProject: (gitRoot: string) => Promise<PlanFileInfo[]>;
  dismissPlan: (gitRoot: string, filename: string) => Promise<PlanFileInfo[]>;
  resetPlanIndex: (gitRoot: string) => Promise<PlanFileInfo[]>;
  onPlanChanged: (callback: (data: { filePath: string }) => void) => () => void;
}

export interface PlanFileInfo {
  absolutePath: string;
  name: string;
  title: string | null;
  mtime: string;
}

export interface MemoryFileInfo {
  absolutePath: string;
  name: string;
  sourceKind: 'project' | 'project-local' | 'user' | 'rule' | 'auto';
  isMemory: boolean;
  isExternal: boolean;
  writable: boolean;
  locationHint: string;
}

export interface GitFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | '?' | 'U';  // Added, Modified, Deleted, Renamed, Untracked, Unmerged
  staged: boolean;
  additions: number;
  deletions: number;
  originalLines: number;
}

export interface GitStatusResult {
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitCommitFileResult {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface GitCommitResult {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: GitCommitFileResult[];
  parents: string[];
  refs: string[];
}

export interface InputModeChange {
  sessionId: string;
  mode: "COMMAND" | "AI" | null;
}

export interface TypoSuggestionChange {
  sessionId: string;
  original: string | null;
  suggested: string | null;
  fullSuggestion: string | null;
  type: 'command' | 'subcommand' | null;
}

export interface AutocompleteChange {
  sessionId: string;
  suggestion: string | null;
  ghostText: string | null;
}

export interface McpAttachmentChange {
  attachedSessionId: string | null;
  previousSessionId: string | null;
}

export interface McpStatus {
  isRunning: boolean;
  clientCount: number;
  socketPath: string;
}

export interface ClaudeStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  model?: string;
}

export interface ClaudeSessionChange {
  sessionId: string;        // Terminal session ID
  claudeSessionId: string;  // Claude's session ID for resume
}

// MCP Activity Events
export interface McpToolCallStarted {
  id: number;
  tool: string;
  args?: Record<string, unknown>;
  clientId: string;
  timestamp: number;
}

export interface McpToolCallCompleted {
  id: number;
  tool: string;
  success: boolean;
  duration: number;
  timestamp: number;
  clientId: string;
  error?: string;
}

export interface McpClientInfo {
  name: string;
  version: string;
  instanceId?: string;
}

export interface McpRuntimeInfo {
  hostApp?: string;
  platform?: string;
  arch?: string;
}

export interface McpClientConnected {
  clientId: string;
  clientInfo?: McpClientInfo;
  runtime?: McpRuntimeInfo;
  timestamp: number;
}

export interface McpClientDisconnected {
  clientId: string;
  timestamp: number;
}

export interface McpSocketLost {
  socketPath: string;
  timestamp: number;
  message: string;
}

export interface TrackedClient {
  clientId: string;
  clientInfo?: McpClientInfo;
  runtime?: McpRuntimeInfo;
  connectedAt: number;
}

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}

export {};
