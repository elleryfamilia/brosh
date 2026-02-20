/**
 * SidebarHost — Generic sidebar container
 *
 * Keeps visited plugin panels mounted so switching between plugins is
 * instant (no unmount/remount). Inactive panels are hidden with
 * display:none and receive isActive:false so their data hooks idle.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
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

function getPluginStoredWidth(pluginId: string) {
  const p = getPlugin(pluginId);
  if (!p) return 0;
  return getStoredWidth(pluginId, p.definition.defaultWidth, p.definition.minWidth, p.definition.maxWidth);
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
  // Track which plugins have been opened so we keep them mounted
  const [visitedIds, setVisitedIds] = useState<string[]>([]);

  useEffect(() => {
    if (activePluginId && !visitedIds.includes(activePluginId)) {
      setVisitedIds((prev) => [...prev, activePluginId]);
    }
  }, [activePluginId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-plugin width state
  const [widths, setWidths] = useState<Record<string, number>>({});

  const activePlugin = activePluginId ? getPlugin(activePluginId) : undefined;
  const activeWidth = activePlugin
    ? widths[activePlugin.definition.id] ??
      getStoredWidth(activePlugin.definition.id, activePlugin.definition.defaultWidth, activePlugin.definition.minWidth, activePlugin.definition.maxWidth)
    : 0;

  // Report width whenever active plugin changes or width changes
  const prevReportedRef = useRef<{ id: string | null; width: number }>({ id: null, width: 0 });
  useEffect(() => {
    const effectiveWidth = activePlugin ? activeWidth : 0;
    if (
      prevReportedRef.current.id !== activePluginId ||
      prevReportedRef.current.width !== effectiveWidth
    ) {
      prevReportedRef.current = { id: activePluginId, width: effectiveWidth };
      onWidthChange(effectiveWidth);
    }
  }, [activePluginId, activePlugin, activeWidth, onWidthChange]);

  // Stable per-plugin resize handlers (cached in a ref)
  const resizeHandlersRef = useRef<Record<string, (w: number) => void>>({});
  function getResizeHandler(pluginId: string): (w: number) => void {
    if (!resizeHandlersRef.current[pluginId]) {
      resizeHandlersRef.current[pluginId] = (newWidth: number) => {
        const p = getPlugin(pluginId);
        if (!p) return;
        const { minWidth, maxWidth, id } = p.definition;
        const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
        setWidths((prev) => ({ ...prev, [id]: clamped }));
        localStorage.setItem(`sidebar:${id}:width`, String(clamped));
      };
    }
    return resizeHandlersRef.current[pluginId];
  }

  // Two stable context objects — one for active, one for inactive.
  // Avoids creating new objects per panel per render.
  const activeContext = useMemo<PluginContext>(
    () => ({
      workspace,
      isActive: true,
      openFile: onOpenFile,
      closeEditor: onCloseEditor,
      editorFilePath,
    }),
    [workspace, onOpenFile, onCloseEditor, editorFilePath]
  );

  const inactiveContext = useMemo<PluginContext>(
    () => ({
      workspace,
      isActive: false,
      openFile: onOpenFile,
      closeEditor: onCloseEditor,
      editorFilePath,
    }),
    [workspace, onOpenFile, onCloseEditor, editorFilePath]
  );

  if (visitedIds.length === 0) return null;

  return (
    <>
      {visitedIds.map((id) => {
        const plugin = getPlugin(id);
        if (!plugin) return null;

        const isActive = id === activePluginId;
        const Panel = plugin.Panel;
        const w = widths[id] ?? getPluginStoredWidth(id);

        return (
          <div key={id} style={isActive ? undefined : { display: 'none' }}>
            <Panel
              context={isActive ? activeContext : inactiveContext}
              width={w}
              onResize={getResizeHandler(id)}
              onClose={onClose}
            />
          </div>
        );
      })}
    </>
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
    plugin.definition.maxWidth,
  );
}
