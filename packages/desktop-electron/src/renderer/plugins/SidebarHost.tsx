/**
 * SidebarHost — Generic sidebar container
 *
 * Keeps visited plugin panels mounted so switching between plugins is
 * instant (no unmount/remount). Inactive panels are hidden with
 * display:none and receive isActive:false so their data hooks idle.
 */

import { useState, useMemo, useEffect, useRef, Suspense } from 'react';
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

function getStoredSharedWidth(): number | null {
  const stored = localStorage.getItem('sidebar:width');
  if (!stored) return null;
  const parsed = parseInt(stored, 10);
  return isNaN(parsed) ? null : parsed;
}

function clampToPlugin(width: number, minWidth: number, maxWidth: number): number {
  return Math.max(minWidth, Math.min(maxWidth, width));
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

  // Single shared sidebar width
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    return getStoredSharedWidth() ?? 280;
  });

  const activePlugin = activePluginId ? getPlugin(activePluginId) : undefined;
  const activeWidth = activePlugin
    ? clampToPlugin(sidebarWidth, activePlugin.definition.minWidth, activePlugin.definition.maxWidth)
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

  // Shared resize handler — updates the single sidebar width, clamped to active plugin
  const resizeHandlerRef = useRef<(w: number) => void>();
  // Recreate when active plugin changes so clamping uses the right constraints
  const activeDefRef = useRef(activePlugin?.definition);
  activeDefRef.current = activePlugin?.definition;
  if (!resizeHandlerRef.current) {
    resizeHandlerRef.current = (newWidth: number) => {
      const def = activeDefRef.current;
      if (!def) return;
      const clamped = clampToPlugin(newWidth, def.minWidth, def.maxWidth);
      setSidebarWidth(clamped);
      localStorage.setItem('sidebar:width', String(clamped));
    };
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

  // Track panels that have completed their initial slide-in animation.
  // When re-showing a panel (display:none → visible), CSS animations replay.
  // We suppress this by adding a class that overrides animation to 'none'.
  const shownOnceRef = useRef<Set<string>>(new Set());
  // After each render where a panel becomes active, mark it as shown
  useEffect(() => {
    if (activePluginId) {
      // Use a microtask so the first render (with animation) completes before marking
      const raf = requestAnimationFrame(() => {
        shownOnceRef.current.add(activePluginId);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [activePluginId]);

  if (visitedIds.length === 0) return null;

  return (
    <>
      {visitedIds.map((id) => {
        const plugin = getPlugin(id);
        if (!plugin) return null;

        const isActive = id === activePluginId;
        const Panel = plugin.Panel;
        const { minWidth, maxWidth } = plugin.definition;
        const w = clampToPlugin(sidebarWidth, minWidth, maxWidth);
        // Suppress slide-in on re-show: panel was shown before and is becoming active again
        const suppressAnim = shownOnceRef.current.has(id);

        return (
          <div
            key={id}
            style={isActive ? undefined : { display: 'none' }}
            className={suppressAnim ? 'sidebar-no-anim' : undefined}
          >
            <Suspense fallback={<div className="sidebar-loading" />}>
              <Panel
                context={isActive ? activeContext : inactiveContext}
                width={w}
                onResize={resizeHandlerRef.current!}
                onClose={onClose}
              />
            </Suspense>
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
  const shared = getStoredSharedWidth();
  const base = shared ?? plugin.definition.defaultWidth;
  return clampToPlugin(base, plugin.definition.minWidth, plugin.definition.maxWidth);
}
