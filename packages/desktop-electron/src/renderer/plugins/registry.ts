/**
 * Plugin Registry
 *
 * Central store for sidebar plugins. Plugins self-register at import time.
 */

import type { RegisteredPlugin } from './types';

const plugins: RegisteredPlugin[] = [];

/** Register a sidebar plugin. Called at module init time by each plugin. */
export function registerSidebarPlugin(plugin: RegisteredPlugin): void {
  // Prevent duplicate registration
  if (plugins.some((p) => p.definition.id === plugin.definition.id)) {
    console.warn(`[plugins] Duplicate registration for "${plugin.definition.id}" — skipped`);
    return;
  }
  plugins.push(plugin);
  // Keep sorted by badgeOrder
  plugins.sort((a, b) => a.definition.badgeOrder - b.definition.badgeOrder);
}

/** Returns all registered plugins, sorted by badgeOrder. */
export function getPlugins(): readonly RegisteredPlugin[] {
  return plugins;
}

/** Lookup a plugin by ID. */
export function getPlugin(id: string): RegisteredPlugin | undefined {
  return plugins.find((p) => p.definition.id === id);
}
