/**
 * Smart Status Bar Types
 *
 * Type definitions for the Smart Status Bar component system.
 */

import type { EnhancedClient, AggregateMetrics, HealthStatus } from '../mcp-dashboard/types';
import type { ClaudeStatus } from '../../types/electron.d';

// Command mark from OSC 133 shell integration
export interface CommandMark {
  type: 'prompt-start' | 'command-start' | 'output-start' | 'command-end';
  exitCode?: number;
}

// Git file change info
export interface GitFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | '?' | 'U';  // Added, Modified, Deleted, Renamed, Untracked, Unmerged
  staged: boolean;
  additions: number;
  deletions: number;
  originalLines: number;
}

// Git status info
export interface GitStatus {
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

// Git commit file change info (for commit history)
export interface GitCommitFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
  oldPath?: string;
}

// Git commit info
export interface GitCommit {
  hash: string;       // 7-char abbreviated
  message: string;    // subject line only
  author: string;
  date: string;       // ISO 8601
  files: GitCommitFile[];
  parents: string[];  // abbreviated parent hashes (0=root, 1=normal, 2+=merge)
  refs: string[];     // branch/tag decorations
}

// Environment detection info
export interface EnvironmentInfo {
  type: 'venv' | 'conda' | 'nvm' | 'nix' | null;
  name: string | null;
  version: string | null;
  path: string | null;
}

// Session context for "Continue in Claude"
export interface SessionContext {
  commands: Array<{
    command: string;
    output?: string;
    exitCode?: number;
    timestamp: number;
  }>;
  cwd: string;
  gitStatus?: GitStatus;
  environment?: EnvironmentInfo;
}

// Status bar state
export interface StatusBarState {
  // MCP
  mcpClients: Map<string, EnhancedClient>;
  mcpModalOpen: boolean;
  aggregateMetrics: AggregateMetrics;

  // Continue in Claude
  sessionContext: SessionContext | null;
  claudeModalOpen: boolean;
  claudeStatus: ClaudeStatus | null;

  // Error
  lastExitCode: number | null;
  lastStderr: string | null;
  errorDismissed: boolean;
  errorModalOpen: boolean;

  // Git
  gitStatus: GitStatus | null;
  gitModalOpen: boolean;

  // Recording
  isRecording: boolean;
  recordingStartTime: number | null;
  recordingSessionId: string | null;
  recordingModalOpen: boolean;

  // Port
  detectedPort: number | null;
  portModalOpen: boolean;

  // Environment
  envInfo: EnvironmentInfo | null;
  envModalOpen: boolean;
}

// Badge visibility state
export interface BadgeVisibility {
  mcp: boolean;
  claude: boolean;
  error: boolean;
  git: boolean;
  recording: boolean;
  port: boolean;
  environment: boolean;
}

// Props for the main SmartStatusBar component
export interface SmartStatusBarProps {
  // MCP state
  mcpAttachedSessionId: string | null;

  // Recording state
  recordingSessionId: string | null;
  recordingElapsed: number;

  // Focused session for error/git/env tracking
  focusedSessionId: string | null;

  // Callbacks
  onMcpToggle?: (sessionId: string) => void;
  onRecordingToggle?: (sessionId: string) => void;
  onShowMcpInstructions?: () => void;
}

// Props for StatusBarBadge component
export interface StatusBarBadgeProps {
  label: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  active?: boolean;
  pulsing?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

// Props for StatusBarModal component
export interface StatusBarModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  position?: 'bottom-left' | 'bottom-right' | 'bottom-center';
  width?: number;
}

// Recording modal props
export interface RecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  elapsed: number;
  onStop: () => void;
  onDiscard?: () => void;
}

// Error modal props
export interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  exitCode: number;
  stderr?: string;
  onDiagnose?: () => void;
  onDismiss: () => void;
}

// Git modal props (informational only, no actions)
export interface GitModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: GitStatus;
}
