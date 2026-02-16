/**
 * GitSidebar Component
 *
 * Left-side sidebar panel with two independently scrollable sections:
 * - Changes (uncommitted file changes)
 * - Commits (recent commit history with expandable cards)
 */

import { useCallback, useRef, useEffect, useMemo, useState } from "react";
import type { GitStatus, GitCommit } from "../smart-status-bar/types";
import { CheckIcon, CloseIcon } from "./icons";
import { GitIcon } from "../icons/GitIcon";
import { FileChangeItem } from "./FileChangeItem";
import { CommitCard } from "./CommitCard";
import { computeGraphLayout } from "./graph-layout";

interface GitSidebarProps {
  gitStatus: GitStatus;
  commits: GitCommit[] | null;
  projectRoot: string | null;
  width: number;
  selectedPath?: string | null;
  onResize: (width: number) => void;
  onFileSelect: (relativePath: string, commitHash?: string) => void;
  onClose: () => void;
}

export function GitSidebar({
  gitStatus,
  commits,
  projectRoot,
  width,
  selectedPath,
  onResize,
  onFileSelect,
  onClose,
}: GitSidebarProps) {
  const { dirty, files } = gitStatus;
  const folderName = projectRoot ? projectRoot.split("/").pop() || projectRoot : "unknown";
  const branchName = gitStatus.branch || "unknown";

  const graphRows = useMemo(() => {
    if (!commits || commits.length === 0) return [];
    return computeGraphLayout(commits);
  }, [commits]);

  // Panel split drag state (ratio 0-1, fraction allocated to changes panel)
  const [splitRatio, setSplitRatio] = useState(0.6);
  const panelsRef = useRef<HTMLDivElement>(null);
  const splitDraggingRef = useRef(false);
  const splitStartYRef = useRef(0);
  const splitStartRatioRef = useRef(0);

  const handleSplitMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      splitDraggingRef.current = true;
      splitStartYRef.current = e.clientY;
      splitStartRatioRef.current = splitRatio;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [splitRatio]
  );

  useEffect(() => {
    const handleSplitMove = (e: MouseEvent) => {
      if (!splitDraggingRef.current || !panelsRef.current) return;
      const panelsHeight = panelsRef.current.offsetHeight;
      if (panelsHeight === 0) return;
      const deltaRatio = (e.clientY - splitStartYRef.current) / panelsHeight;
      const newRatio = Math.min(0.85, Math.max(0.15, splitStartRatioRef.current + deltaRatio));
      setSplitRatio(newRatio);
    };

    const handleSplitUp = () => {
      if (!splitDraggingRef.current) return;
      splitDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleSplitMove);
    document.addEventListener("mouseup", handleSplitUp);
    return () => {
      document.removeEventListener("mousemove", handleSplitMove);
      document.removeEventListener("mouseup", handleSplitUp);
    };
  }, []);

  // Width resize refs
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleFileClick = useCallback(
    (relativePath: string) => {
      onFileSelect(relativePath);
    },
    [onFileSelect]
  );

  // Drag-to-resize logic
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      onResize(startWidthRef.current + delta);
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onResize]);

  return (
    <div className="git-sidebar" style={{ width }}>
      {/* Header */}
      <div className="git-sidebar-header">
        <div className="git-sidebar-header-left">
          <GitIcon size={14} />
          <span className="git-sidebar-folder">{folderName} <span className="git-sidebar-branch">{branchName}</span></span>
        </div>
        <button
          className="git-sidebar-close"
          onClick={onClose}
          title="Close sidebar (Cmd+Shift+G)"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="git-sidebar-panels" ref={panelsRef}>
        {/* Changes panel */}
        <div className="git-sidebar-changes-panel" style={{ flex: `0 0 ${splitRatio * 100}%` }}>
          <div className="git-sidebar-section-header">
            Changes ({dirty ? files.length : 0})
          </div>
          <div className="git-sidebar-panel-scroll">
            {dirty && files.length > 0 ? (
              <div className="git-sidebar-file-list">
                {files.map((file) => (
                  <FileChangeItem
                    key={file.path}
                    file={file}
                    selected={selectedPath ? selectedPath.endsWith('/' + file.path) : false}
                    onClick={() => handleFileClick(file.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="git-sidebar-clean">
                <CheckIcon size={20} className="git-sidebar-clean-icon" />
                <span>Working tree clean</span>
              </div>
            )}
          </div>
        </div>

        {/* Draggable divider */}
        <div
          className="git-sidebar-panel-divider"
          onMouseDown={handleSplitMouseDown}
        />

        {/* Commits panel */}
        <div className="git-sidebar-commits-panel" style={{ flex: 1 }}>
          <div className="git-sidebar-section-header">
            Commits
          </div>
          <div className="git-sidebar-panel-scroll">
            {commits && commits.length > 0 ? (
              commits.map((commit, index) => (
                <CommitCard
                  key={commit.hash}
                  commit={commit}
                  graphRow={graphRows[index]}
                  onFileSelect={onFileSelect}
                />
              ))
            ) : commits === null ? (
              <div className="git-sidebar-clean">
                <span>Loading...</span>
              </div>
            ) : (
              <div className="git-sidebar-clean">
                <span>No commits</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="git-sidebar-resize-handle"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}
