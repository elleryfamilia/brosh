/**
 * usePluginShortcuts Hook
 *
 * Returns a keydown handler that checks all registered plugin shortcuts.
 * Only fires for plugins that are currently relevant.
 */

import { useCallback } from 'react';
import { getPlugins } from './registry';
import type { WorkspaceContext } from './types';

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

interface UsePluginShortcutsParams {
  workspace: WorkspaceContext;
  onTogglePlugin: (pluginId: string) => void;
}

/**
 * Returns a keydown handler to install on `window`.
 * Call this from App.tsx's keyboard shortcut effect.
 */
export function usePluginShortcuts({
  workspace,
  onTogglePlugin,
}: UsePluginShortcutsParams): (e: KeyboardEvent) => boolean {
  return useCallback(
    (e: KeyboardEvent): boolean => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (!isMod) return false;

      for (const plugin of getPlugins()) {
        const { shortcut, id, isRelevant } = plugin.definition;

        // Check modifier match
        if (shortcut.shift && !e.shiftKey) continue;
        if (!shortcut.shift && e.shiftKey) continue;

        // Check key match
        if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) continue;

        // Only fire for relevant plugins
        if (!isRelevant(workspace)) continue;

        e.preventDefault();
        onTogglePlugin(id);
        return true;
      }

      return false;
    },
    [workspace, onTogglePlugin]
  );
}
