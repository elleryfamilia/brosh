/**
 * Sidebar Plugin System — Type Definitions
 *
 * Interfaces for the generic plugin infrastructure that allows
 * sidebar features (git, docker, search, etc.) to be self-contained.
 */

import type { GitStatus, GitCommit } from '../components/smart-status-bar/types';
import type { DiffSource } from '../types/pane';

// ---------------------------------------------------------------------------
// Workspace Context — shared environment snapshot passed to all plugins
// ---------------------------------------------------------------------------

export interface WorkspaceContext {
  /** Current git status (null when outside a git repo) */
  git: {
    status: GitStatus;
    commits: GitCommit[] | null;
    projectRoot: string;
  } | null;

  /** Focused terminal session ID */
  focusedSessionId: string | null;

  /** Current working directory of the focused terminal */
  cwd: string | null;
}

// ---------------------------------------------------------------------------
// Plugin Definition — static metadata registered once at startup
// ---------------------------------------------------------------------------

export interface SidebarPluginDefinition {
  /** Unique identifier (e.g. 'git', 'docker', 'search') */
  id: string;

  /** Human-readable name */
  name: string;

  /** Keyboard shortcut descriptor — {mod} is Cmd on Mac, Ctrl elsewhere */
  shortcut: { mod: true; shift?: boolean; key: string };

  /** Ordering for badge rendering in the status bar (lower = further left) */
  badgeOrder: number;

  /** Default sidebar width */
  defaultWidth: number;

  /** Min/max width constraints */
  minWidth: number;
  maxWidth: number;

  /**
   * Pure function that determines whether this plugin is relevant
   * in the current workspace. When false, badge and shortcut are hidden.
   */
  isRelevant: (ctx: WorkspaceContext) => boolean;
}

// ---------------------------------------------------------------------------
// Plugin Context — passed to the active panel component
// ---------------------------------------------------------------------------

export interface PluginContext {
  workspace: WorkspaceContext;
  isActive: boolean;

  /** Open a file in the editor panel */
  openFile: (filePath: string, isDiff?: boolean, diffSource?: DiffSource) => void;

  /** Close the editor panel */
  closeEditor: () => void;

  /** Currently open editor file path (for selection highlighting) */
  editorFilePath: string | null;
}

export type { DiffSource };

// ---------------------------------------------------------------------------
// Editor Panel — optional custom editor provided by a plugin
// ---------------------------------------------------------------------------

export interface EditorPanelProps {
  filePath: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Badge — status bar rendering
// ---------------------------------------------------------------------------

export interface BadgeState {
  visible: boolean;
  label: string;
  tooltip: string;
  /** When true, badge pulses or shows attention indicator */
  attention: boolean;
}

export interface BadgeProps {
  state: BadgeState;
  isActive: boolean;
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// Panel — sidebar rendering
// ---------------------------------------------------------------------------

export interface PanelProps {
  context: PluginContext;
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Registered Plugin — definition + React components + badge state hook
// ---------------------------------------------------------------------------

export interface RegisteredPlugin {
  definition: SidebarPluginDefinition;

  /** Status bar badge component */
  Badge: React.ComponentType<BadgeProps>;

  /** Sidebar panel component */
  Panel: React.ComponentType<PanelProps>;

  /** Optional custom editor panel (replaces default EditorPane for this plugin) */
  EditorPanel?: React.ComponentType<EditorPanelProps>;

  /** Pure function deriving badge state from workspace context */
  getBadgeState: (ctx: WorkspaceContext) => BadgeState;
}
