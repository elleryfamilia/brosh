/**
 * SidebarHost — Generic sidebar container
 *
 * Renders the active plugin's Panel component with width management.
 * Handles per-plugin width persistence via localStorage.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getPlugin } from './registry';
import type { PluginContext, DiffSource, WorkspaceContext } from './types';

interface SidebarHostProps {
  /** ID of the active sidebar plugin, or null if none open */
  activePluginId: string | null;
  workspace: WorkspaceContext;

  /** Editor panel callbacks (shared resource — owned by App.tsx) */
  onOpenFile: (filePath: string, isDiff?: boolean, diffSource?: DiffSource) => void;
  onCloseEditor: () => void;
  editorFilePath: string | null;

  /** Called when sidebar requests close */
  onClose: () => void;

  /** Reports the current width so App.tsx can adjust terminal layout */
  onWidthChange: (width: number) => void;
}

function getStoredWidth(pluginId: string, defaultWidth: number, minWidth: number, maxWidth: number): number {
  const stored = localStorage.getItem(`sidebar:${pluginId}:width`);
  if (!stored) return defaultWidth;
  const parsed = parseInt(stored, 10);
  if (isNaN(parsed)) return defaultWidth;
  return Math.max(minWidth, Math.min(maxWidth, parsed));
}

export function SidebarHost({
  activePluginId,
  workspace,
  onOpenFile,
  onCloseEditor,
  editorFilePath,
  onClose,
  onWidthChange,
}: SidebarHostProps) {
  const plugin = activePluginId ? getPlugin(activePluginId) : undefined;

  // Per-plugin width state
  const [widths, setWidths] = useState<Record<string, number>>({});

  const width = plugin
    ? widths[plugin.definition.id] ??
      getStoredWidth(plugin.definition.id, plugin.definition.defaultWidth, plugin.definition.minWidth, plugin.definition.maxWidth)
    : 0;

  // Report width whenever active plugin changes or width changes
  const prevReportedRef = useRef<{ id: string | null; width: number }>({ id: null, width: 0 });
  useEffect(() => {
    const effectiveWidth = plugin ? width : 0;
    if (
      prevReportedRef.current.id !== activePluginId ||
      prevReportedRef.current.width !== effectiveWidth
    ) {
      prevReportedRef.current = { id: activePluginId, width: effectiveWidth };
      onWidthChange(effectiveWidth);
    }
  }, [activePluginId, plugin, width, onWidthChange]);

  // Width resize handler — delegates to panel's built-in resize handle
  const handleResize = useCallback(
    (newWidth: number) => {
      if (!plugin) return;
      const { minWidth, maxWidth, id } = plugin.definition;
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidths((prev) => ({ ...prev, [id]: clamped }));
      localStorage.setItem(`sidebar:${id}:width`, String(clamped));
    },
    [plugin]
  );

  // Assemble PluginContext
  const context = useMemo<PluginContext>(
    () => ({
      workspace,
      isActive: activePluginId !== null,
      openFile: onOpenFile,
      closeEditor: onCloseEditor,
      editorFilePath,
    }),
    [workspace, activePluginId, onOpenFile, onCloseEditor, editorFilePath]
  );

  if (!plugin || !activePluginId) return null;

  const Panel = plugin.Panel;

  return (
    <Panel
      context={context}
      width={width}
      onResize={handleResize}
      onClose={onClose}
    />
  );
}

/** Utility to read the persisted width for a plugin without rendering SidebarHost */
export function getPluginWidth(pluginId: string): number {
  const plugin = getPlugin(pluginId);
  if (!plugin) return 0;
  return getStoredWidth(
    pluginId,
    plugin.definition.defaultWidth,
    plugin.definition.minWidth,
    plugin.definition.maxWidth
  );
}
