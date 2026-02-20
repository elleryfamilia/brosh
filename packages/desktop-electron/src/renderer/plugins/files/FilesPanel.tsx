/**
 * FilesPanel — File browser sidebar panel
 *
 * Lazy-loaded directory tree with file-type icons, expand/collapse,
 * right-click context menu, inline rename, and new file/folder creation.
 */

import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PanelProps } from '../types';
import { useFilesData, type DirEntry } from './useFilesData';
import { FileIcon, FolderIcon, ChevronIcon } from './FileIcon';
import { FilesIcon } from './FilesIcon';
import { ContextMenu, type ContextMenuGroup } from '../../components/ContextMenu';

type InlineCreate = {
  parentDir: string;
  type: 'file' | 'folder';
};

export function FilesPanel({ context, width, onResize, onClose }: PanelProps) {
  const { workspace } = context;
  const gitRoot = workspace.git?.projectRoot ?? null;

  const {
    expandedDirs,
    root,
    rootEntries,
    loading,
    toggleDir,
    expandDir,
    createFile,
    createFolder,
    refreshDir,
    renameEntry,
    deleteEntry,
    moveEntry,
  } = useFilesData({
    isActive: context.isActive,
    cwd: workspace.cwd,
    gitRoot,
  });

  const [inlineCreate, setInlineCreate] = useState<InlineCreate | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<DirEntry | null>(null);

  // Drag-and-drop state
  const [dragSrcPath, setDragSrcPath] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const dragCounterRef = useRef<Map<string, number>>(new Map());

  const folderName = root?.split('/').pop() ?? 'unknown';

  const handleFileClick = useCallback(
    (entry: DirEntry) => {
      if (entry.isDirectory) {
        toggleDir(entry.path);
      } else {
        context.openFile(entry.path);
      }
    },
    [context, toggleDir]
  );

  const handleNewFile = useCallback(() => {
    setInlineCreate({ parentDir: root || '', type: 'file' });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [root]);

  const handleNewFolder = useCallback(() => {
    setInlineCreate({ parentDir: root || '', type: 'folder' });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [root]);

  const handleInlineSubmit = useCallback(async (name: string) => {
    if (!inlineCreate || !name.trim()) {
      setInlineCreate(null);
      return;
    }

    const trimmed = name.trim();
    if (inlineCreate.type === 'file') {
      const success = await createFile(inlineCreate.parentDir, trimmed);
      if (success) {
        context.openFile(`${inlineCreate.parentDir}/${trimmed}`);
      }
    } else {
      await createFolder(inlineCreate.parentDir, trimmed);
    }
    setInlineCreate(null);
  }, [inlineCreate, createFile, createFolder, context]);

  const handleInlineKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInlineSubmit((e.target as HTMLInputElement).value);
    } else if (e.key === 'Escape') {
      setInlineCreate(null);
    }
  }, [handleInlineSubmit]);

  const handleRefresh = useCallback(() => {
    if (root) refreshDir(root);
  }, [root, refreshDir]);

  // --- Rename ---
  const startRename = useCallback((entry: DirEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  }, []);

  const submitRename = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const parentDir = renamingPath.substring(0, renamingPath.lastIndexOf('/'));
    const newPath = `${parentDir}/${renameValue.trim()}`;
    if (newPath !== renamingPath) {
      await renameEntry(renamingPath, newPath);
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, renameEntry]);

  const cancelRename = useCallback(() => setRenamingPath(null), []);

  // --- Delete ---
  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    if (context.editorFilePath === deleteConfirm.path) {
      context.closeEditor();
    }
    await deleteEntry(deleteConfirm.path);
    setDeleteConfirm(null);
  }, [deleteConfirm, deleteEntry, context]);

  // Sidebar resize
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

  // --- Context menu ---
  const [ctxMenu, setCtxMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    groups: ContextMenuGroup[];
  }>({ isOpen: false, position: { x: 0, y: 0 }, groups: [] });

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Helper: get the parent dir for a file entry (for "new file at same level")
  const getParentDir = (entry: DirEntry) =>
    entry.path.substring(0, entry.path.lastIndexOf('/'));

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry | null) => {
    e.preventDefault();
    e.stopPropagation();

    const groups: ContextMenuGroup[] = [];

    if (entry === null) {
      // Right-clicked on empty space — new file/folder at root
      groups.push({
        id: 'create',
        items: [
          { id: 'new-file', label: 'New File', onClick: () => {
            setInlineCreate({ parentDir: root || '', type: 'file' });
          }},
          { id: 'new-folder', label: 'New Folder', onClick: () => {
            setInlineCreate({ parentDir: root || '', type: 'folder' });
          }},
        ],
      });
    } else if (entry.isDirectory) {
      // Right-clicked on a folder — create inside, rename, delete
      groups.push({
        id: 'create',
        items: [
          { id: 'new-file', label: 'New File', onClick: () => {
            setInlineCreate({ parentDir: entry.path, type: 'file' });
            expandDir(entry.path);
          }},
          { id: 'new-folder', label: 'New Folder', onClick: () => {
            setInlineCreate({ parentDir: entry.path, type: 'folder' });
            expandDir(entry.path);
          }},
        ],
      });
      groups.push({
        id: 'edit',
        items: [
          { id: 'rename', label: 'Rename', onClick: () => startRename(entry) },
          { id: 'delete', label: 'Delete', onClick: () => setDeleteConfirm(entry) },
        ],
      });
    } else {
      // Right-clicked on a file — new at same level, rename, delete
      const parentDir = getParentDir(entry);
      groups.push({
        id: 'create',
        items: [
          { id: 'new-file', label: 'New File', onClick: () => {
            setInlineCreate({ parentDir, type: 'file' });
          }},
          { id: 'new-folder', label: 'New Folder', onClick: () => {
            setInlineCreate({ parentDir, type: 'folder' });
          }},
        ],
      });
      groups.push({
        id: 'edit',
        items: [
          { id: 'rename', label: 'Rename', onClick: () => startRename(entry) },
          { id: 'delete', label: 'Delete', onClick: () => setDeleteConfirm(entry) },
        ],
      });
    }

    groups.push({
      id: 'clipboard',
      items: [
        ...(entry ? [
          { id: 'copy-path', label: 'Copy Path', onClick: () => navigator.clipboard.writeText(entry.path) },
          { id: 'copy-relative', label: 'Copy Relative Path', onClick: () => {
            const rel = root && entry.path.startsWith(root + '/') ? entry.path.slice(root.length + 1) : entry.path;
            navigator.clipboard.writeText(rel);
          }},
          { id: 'reveal', label: 'Reveal in Finder', onClick: () => {
            window.terminalAPI.showInFolder(entry.path);
          }},
        ] : []),
      ],
    });

    // Remove empty groups
    const filtered = groups.filter(g => g.items.length > 0);

    setCtxMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, groups: filtered });
  }, [root, expandDir, startRename]);

  // Auto-focus rename input
  const renameRefCallback = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      const lastDot = renameValue.lastIndexOf('.');
      el.setSelectionRange(0, lastDot > 0 ? lastDot : renameValue.length);
    }
  }, [renameValue]);

  // --- Drag and drop ---
  const handleDragStart = useCallback((e: React.DragEvent, entry: DirEntry) => {
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'move';
    setDragSrcPath(entry.path);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSrcPath(null);
    setDropTargetDir(null);
    dragCounterRef.current.clear();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't allow dropping onto self or into own children
    const srcPath = e.dataTransfer.types.includes('text/plain') ? dragSrcPath : null;
    if (srcPath && (srcPath === dirPath || dirPath.startsWith(srcPath + '/'))) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    setDropTargetDir(dirPath);
  }, [dragSrcPath]);

  const handleDragEnter = useCallback((e: React.DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const count = (dragCounterRef.current.get(dirPath) ?? 0) + 1;
    dragCounterRef.current.set(dirPath, count);
    setDropTargetDir(dirPath);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const count = (dragCounterRef.current.get(dirPath) ?? 0) - 1;
    dragCounterRef.current.set(dirPath, count);
    if (count <= 0) {
      dragCounterRef.current.delete(dirPath);
      if (dropTargetDir === dirPath) setDropTargetDir(null);
    }
  }, [dropTargetDir]);

  const handleDrop = useCallback(async (e: React.DragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetDir(null);
    dragCounterRef.current.clear();

    const srcPath = e.dataTransfer.getData('text/plain');
    if (!srcPath) return;

    // Don't drop onto self or own children
    if (srcPath === destDir || destDir.startsWith(srcPath + '/')) return;

    // Don't move if already in that directory
    const srcParent = srcPath.substring(0, srcPath.lastIndexOf('/'));
    if (srcParent === destDir) return;

    await moveEntry(srcPath, destDir);
    setDragSrcPath(null);
  }, [moveEntry]);

  const renderEntry = (entry: DirEntry, depth: number) => {
    const isExpanded = expandedDirs.has(entry.path);
    const isSelected = context.editorFilePath === entry.path;
    const isRenaming = renamingPath === entry.path;

    const isDragSource = dragSrcPath === entry.path;
    const isDropTarget = entry.isDirectory && dropTargetDir === entry.path;

    return (
      <div key={entry.path}>
        <button
          className={`files-tree-item ${isSelected ? 'files-tree-item--selected' : ''} ${entry.isDirectory ? 'files-tree-item--directory' : ''} ${isDragSource ? 'files-tree-item--dragging' : ''} ${isDropTarget ? 'files-tree-item--drop-target' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => !isRenaming && handleFileClick(entry)}
          onContextMenu={(e) => handleContextMenu(e, entry)}
          draggable={!isRenaming}
          onDragStart={(e) => handleDragStart(e, entry)}
          onDragEnd={handleDragEnd}
          {...(entry.isDirectory ? {
            onDragOver: (e: React.DragEvent) => handleDragOver(e, entry.path),
            onDragEnter: (e: React.DragEvent) => handleDragEnter(e, entry.path),
            onDragLeave: (e: React.DragEvent) => handleDragLeave(e, entry.path),
            onDrop: (e: React.DragEvent) => handleDrop(e, entry.path),
          } : {})}
          type="button"
          title={entry.path}
        >
          {entry.isDirectory ? (
            <ChevronIcon expanded={isExpanded} size={14} />
          ) : (
            <span className="files-tree-chevron-spacer" />
          )}
          {entry.isDirectory ? (
            <FolderIcon open={isExpanded} size={16} />
          ) : (
            <FileIcon filename={entry.name} size={16} />
          )}
          {isRenaming ? (
            <input
              ref={renameRefCallback}
              className="files-inline-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') cancelRename();
              }}
              onBlur={cancelRename}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="files-tree-name">{entry.name}</span>
          )}
        </button>

        {/* Inline create inside this expanded directory */}
        {entry.isDirectory && isExpanded && inlineCreate?.parentDir === entry.path && (
          <div className="files-tree-item" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
            <span className="files-tree-chevron-spacer" />
            {inlineCreate.type === 'folder' ? (
              <FolderIcon size={16} />
            ) : (
              <FileIcon filename="" size={16} />
            )}
            <input
              ref={inputRef}
              className="files-inline-input"
              type="text"
              placeholder={inlineCreate.type === 'file' ? 'filename' : 'folder name'}
              onKeyDown={handleInlineKeyDown}
              onBlur={() => setInlineCreate(null)}
              autoFocus
            />
          </div>
        )}

        {entry.isDirectory && isExpanded && expandedDirs.get(entry.path)?.map((child) =>
          renderEntry(child, depth + 1)
        )}
      </div>
    );
  };

  return (
    <div className="docs-panel" style={{ width }}>
      <div className="docs-panel-header">
        <div className="docs-panel-header-left">
          <FilesIcon size={14} />
          <span className="docs-panel-title">{folderName} - Files</span>
        </div>
        <div className="docs-panel-actions">
          <button className="docs-panel-btn" onClick={handleNewFile} title="New File" type="button">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-4-4z" />
              <line x1="8" y1="8" x2="8" y2="12" />
              <line x1="6" y1="10" x2="10" y2="10" />
            </svg>
          </button>
          <button className="docs-panel-btn" onClick={handleNewFolder} title="New Folder" type="button">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h4l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              <line x1="7.5" y1="8" x2="7.5" y2="11" />
              <line x1="6" y1="9.5" x2="9" y2="9.5" />
            </svg>
          </button>
          <button className="docs-panel-btn" onClick={handleRefresh} title="Refresh" type="button" disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v4h4" />
              <path d="M3.51 10a6 6 0 1 0 .49-5L1 8" />
            </svg>
          </button>
          <button className="docs-panel-btn" onClick={onClose} title="Close sidebar" type="button">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={`docs-panel-body files-tree ${dropTargetDir === root ? 'files-tree--drop-active' : ''}`}
        onContextMenu={(e) => {
          // Only fire for empty space — if a tree item handled it, propagation is stopped
          handleContextMenu(e, null);
        }}
        onDragOver={(e) => { if (root) handleDragOver(e, root); }}
        onDragEnter={(e) => { if (root) handleDragEnter(e, root); }}
        onDragLeave={(e) => { if (root) handleDragLeave(e, root); }}
        onDrop={(e) => { if (root) handleDrop(e, root); }}
      >
        {/* Inline create at root level */}
        {inlineCreate && inlineCreate.parentDir === root && (
          <div className="files-tree-item" style={{ paddingLeft: 8 }}>
            <span className="files-tree-chevron-spacer" />
            {inlineCreate.type === 'folder' ? (
              <FolderIcon size={16} />
            ) : (
              <svg className="files-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-4-4z" />
              </svg>
            )}
            <input
              ref={inputRef}
              className="files-inline-input"
              type="text"
              placeholder={inlineCreate.type === 'file' ? 'filename' : 'folder name'}
              onKeyDown={handleInlineKeyDown}
              onBlur={() => setInlineCreate(null)}
              autoFocus
            />
          </div>
        )}

        {rootEntries.map((entry) => renderEntry(entry, 0))}

        {!loading && rootEntries.length === 0 && (
          <div className="docs-grid-empty">
            No files in this directory
          </div>
        )}
      </div>

      <div className="docs-panel-resize-handle" onMouseDown={handleResizeStart} />

      {/* Context menu — portaled to body for z-index stacking */}
      {createPortal(
        <ContextMenu
          isOpen={ctxMenu.isOpen}
          position={ctxMenu.position}
          groups={ctxMenu.groups}
          onClose={closeCtxMenu}
        />,
        document.body
      )}

      {/* Delete confirmation dialog — portaled to body */}
      {deleteConfirm && createPortal(
        <div className="files-confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="files-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="files-confirm-title">Move to Trash?</div>
            <div className="files-confirm-message">
              &ldquo;{deleteConfirm.name}&rdquo; will be moved to the trash.
            </div>
            <div className="files-confirm-actions">
              <button
                className="files-confirm-btn files-confirm-btn--cancel"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="files-confirm-btn files-confirm-btn--danger"
                onClick={confirmDelete}
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
