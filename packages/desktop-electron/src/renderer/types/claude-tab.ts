/**
 * Claude Tab Type Definitions
 *
 * Data structures for multi-session Claude panel tabs.
 * Each tab represents a Claude Code CLI session, optionally
 * running in a specific git worktree.
 */

export interface ClaudeTab {
  /** Unique tab identifier */
  id: string;
  /** Terminal session ID — null before launch or after exit */
  sessionId: string | null;
  /** Display label (directory basename or worktree name) */
  label: string;
  /** Working directory for this Claude session */
  cwd: string;
  /** Git worktree name, if launched in a worktree */
  worktreeName?: string;
  /** Timestamp when the tab was created */
  createdAt: number;
  /** Whether the Claude session has exited */
  exited: boolean;
}

/** Worktree entry returned from `git worktree list --porcelain` */
export interface GitWorktree {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name (e.g., "main", "feature/foo") */
  branch: string | null;
  /** Short commit hash */
  head: string;
  /** Whether this is the bare/main worktree */
  isBare: boolean;
}

/** Minimal localStorage-persistable tab data */
export interface PersistedClaudeTab {
  id: string;
  label: string;
  cwd: string;
  worktreeName?: string;
}
