/**
 * DocsPanel — Agent Context sidebar
 *
 * Two-section layout matching Figma design:
 * 1. MEMORY (n)          — Claude memory/context files
 * 2. PROJECT DOCUMENTS (n) — Git-tracked markdown files
 */

import { useState, useCallback, useRef } from 'react';
import type { PanelProps } from '../types';
import { useDocsData } from './useDocsData';
import { useMemoryFiles } from './useMemoryFiles';
import { DocGrid } from './DocGrid';
import { MemorySection } from './MemorySection';
import { DocsIcon } from './DocsIcon';

export function DocsPanel({ context, width, onResize, onClose }: PanelProps) {
  const { workspace, isActive } = context;

  const focusedSessionIdRef = useRef(workspace.focusedSessionId);
  focusedSessionIdRef.current = workspace.focusedSessionId;
  const getFocusedSessionId = useCallback(() => focusedSessionIdRef.current, []);

  const { files, gitRoot, loading, refresh } = useDocsData({
    getFocusedSessionId,
    isActive,
    focusedSessionId: workspace.focusedSessionId,
  });

  const { files: memoryFiles, loading: memoryLoading, refresh: refreshMemory } = useMemoryFiles({
    getFocusedSessionId,
    isActive,
    focusedSessionId: workspace.focusedSessionId,
  });

  const folderName = workspace.git?.projectRoot?.split('/').pop() ?? 'unknown';
  const headerTitle = `${folderName} - Context`;

  // Exclude files already shown in the memory section from project documents
  const memoryRelativePaths = new Set(
    gitRoot
      ? memoryFiles
          .filter((f) => f.absolutePath.startsWith(gitRoot + '/'))
          .map((f) => f.absolutePath.slice(gitRoot.length + 1))
      : []
  );
  const filteredFiles = files.filter((f) => !memoryRelativePaths.has(f.relativePath));

  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Sync selection highlight with host's editor file (for DocGrid relative paths)
  const editorRelative = (() => {
    if (!context.editorFilePath || !gitRoot) return null;
    const prefix = gitRoot + '/';
    return context.editorFilePath.startsWith(prefix)
      ? context.editorFilePath.slice(prefix.length)
      : null;
  })();
  const highlightedDocPath = editorRelative ?? selectedPath;

  // For memory section, highlight by absolute path
  const highlightedMemoryPath = context.editorFilePath ?? null;

  const handleDocSelect = useCallback(
    (relativePath: string) => {
      setSelectedPath(relativePath);
      const absPath = gitRoot ? `${gitRoot}/${relativePath}` : relativePath;
      context.openFile(absPath);
    },
    [gitRoot, context]
  );

  const handleMemorySelect = useCallback(
    (absolutePath: string) => {
      setSelectedPath(null);
      context.openFile(absolutePath);
    },
    [context]
  );

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshMemory()]);
  }, [refresh, refreshMemory]);

  // Sidebar resize (right edge)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: width };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientX - resizeRef.current.startX;
        onResize(resizeRef.current.startWidth + delta);
      };
      const handleMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, onResize]
  );

  // Vertical split-pane: memory (top) / docs (bottom)
  // topHeight: null = fit content, number = user-dragged pixel height
  const [topHeight, setTopHeight] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleSplitStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const topPane = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    if (!topPane) return;
    const currentHeight = topPane.getBoundingClientRect().height;
    splitDragRef.current = { startY: e.clientY, startHeight: currentHeight };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!splitDragRef.current || !bodyRef.current) return;
      const delta = ev.clientY - splitDragRef.current.startY;
      const bodyHeight = bodyRef.current.clientHeight;
      const newHeight = Math.max(40, Math.min(bodyHeight - 80, splitDragRef.current.startHeight + delta));
      setTopHeight(newHeight);
    };
    const handleMouseUp = () => {
      splitDragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const showBothSections = memoryFiles.length > 0 && filteredFiles.length > 0;

  return (
    <div className="docs-panel" style={{ width }}>
      <div className="docs-panel-header">
        <div className="docs-panel-header-left">
          <DocsIcon size={14} />
          <span className="docs-panel-title">{headerTitle}</span>
        </div>
        <div className="docs-panel-actions">
          <button
            className="docs-panel-btn"
            onClick={handleRefreshAll}
            title="Refresh"
            type="button"
            disabled={loading || memoryLoading}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v4h4" />
              <path d="M3.51 10a6 6 0 1 0 .49-5L1 8" />
            </svg>
          </button>
          <button
            className="docs-panel-btn"
            onClick={onClose}
            title="Close sidebar"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="docs-panel-body" ref={bodyRef}>
        {showBothSections ? (
          <>
            <div
              className="ctx-split-pane ctx-split-top"
              style={topHeight != null ? { flex: `0 0 ${topHeight}px`, overflow: 'auto' } : undefined}
            >
              <MemorySection
                files={memoryFiles}
                selectedPath={highlightedMemoryPath}
                onSelect={handleMemorySelect}
              />
            </div>

            <div className="ctx-split-divider" onMouseDown={handleSplitStart} />

            <div className="ctx-split-pane ctx-split-bottom" style={{ flex: 1 }}>
              <div className="ctx-docs-section">
                <div className="ctx-section-header">
                  Project Documents ({filteredFiles.length})
                </div>
                <DocGrid
                  files={filteredFiles}
                  selectedPath={highlightedDocPath}
                  onSelect={handleDocSelect}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <MemorySection
              files={memoryFiles}
              selectedPath={highlightedMemoryPath}
              onSelect={handleMemorySelect}
            />

            {filteredFiles.length > 0 && (
              <div className="ctx-docs-section">
                <div className="ctx-section-header">
                  Project Documents ({filteredFiles.length})
                </div>
                <DocGrid
                  files={filteredFiles}
                  selectedPath={highlightedDocPath}
                  onSelect={handleDocSelect}
                />
              </div>
            )}
          </>
        )}

        {memoryFiles.length === 0 && filteredFiles.length === 0 && !loading && !memoryLoading && (
          <div className="docs-grid-empty">
            No context or markdown files found
          </div>
        )}
      </div>

      {/* Resize handle (right edge) */}
      <div className="docs-panel-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  );
}
