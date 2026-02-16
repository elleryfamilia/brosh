/**
 * Plugin System — Barrel Import
 *
 * Importing this module triggers self-registration of all built-in plugins.
 */

// Register built-in plugins
import './git/index';
import './docs/index';
import './plans/index';

// Re-export infrastructure
export { registerSidebarPlugin, getPlugins, getPlugin } from './registry';
export { SidebarHost, getPluginWidth } from './SidebarHost';
export { useWorkspaceContext } from './useWorkspaceContext';
export { usePluginShortcuts } from './usePluginShortcuts';
export type {
  WorkspaceContext,
  SidebarPluginDefinition,
  PluginContext,
  EditorPanelProps,
  BadgeState,
  BadgeProps,
  PanelProps,
  RegisteredPlugin,
  DiffSource,
} from './types';
