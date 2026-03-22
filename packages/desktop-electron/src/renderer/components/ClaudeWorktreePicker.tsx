/**
 * Claude Worktree Picker Component
 *
 * A "+" button that opens a popover listing worktrees to launch Claude in.
 * Reused in both the panel header and the tab bar.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ClaudeTab, GitWorktree } from "../types/claude-tab";

interface ClaudeWorktreePickerProps {
  tabs: ClaudeTab[];
  onAddTab: (worktree?: GitWorktree) => void;
  /** CSS class for the button */
  buttonClassName?: string;
  /** Current working directory — its worktree is filtered out */
  currentCwd?: string;
}

export function ClaudeWorktreePicker({
  tabs,
  onAddTab,
  buttonClassName = "claude-panel-header-btn",
  currentCwd,
}: ClaudeWorktreePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loadingWorktrees, setLoadingWorktrees] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    // Use mouseup so that click handlers on buttons inside fire first
    document.addEventListener("mouseup", handleClick);
    return () => document.removeEventListener("mouseup", handleClick);
  }, [showPicker]);

  const handleAddClick = useCallback(async () => {
    setShowPicker(true);
    setLoadingWorktrees(true);
    try {
      const result = await window.terminalAPI.gitListWorktrees(currentCwd);
      if (result.success && result.worktrees) {
        const openCwds = new Set(tabs.map((t) => t.cwd));
        // Filter out: already open, current directory, and bare worktrees
        const candidates = result.worktrees.filter((w) =>
          !w.isBare &&
          !openCwds.has(w.path) &&
          w.path !== currentCwd
        );
        // Verify each worktree directory still exists
        const verified: GitWorktree[] = [];
        for (const w of candidates) {
          try {
            const stat = await window.terminalAPI.statFile(w.path);
            if (stat.success && stat.stat?.isDirectory) verified.push(w);
          } catch {
            // Directory doesn't exist, skip
          }
        }
        setWorktrees(verified);
      } else {
        setWorktrees([]);
      }
    } catch {
      setWorktrees([]);
    }
    setLoadingWorktrees(false);
  }, [tabs, currentCwd]);

  const handleWorktreeSelect = useCallback(
    (wt: GitWorktree) => {
      setShowPicker(false);
      onAddTab(wt);
    },
    [onAddTab]
  );

  const handleNewSession = useCallback(() => {
    setShowPicker(false);
    onAddTab();
  }, [onAddTab]);

  const handleRemoveWorktree = useCallback(async (e: React.MouseEvent, wt: GitWorktree) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const result = await window.terminalAPI.gitRemoveWorktree(wt.path);
      if (result.success) {
        setWorktrees((prev) => prev.filter((w) => w.path !== wt.path));
      }
    } catch {
      // Removal failed — leave the worktree in the list
    }
  }, []);

  return (
    <div className="claude-panel-tab-add-wrapper" ref={pickerRef}>
      <button
        className={buttonClassName}
        onClick={handleAddClick}
        title="New Claude session"
        type="button"
      >
        +
      </button>
      {showPicker && (
        <div className="claude-panel-worktree-picker">
          <button
            className="claude-panel-worktree-item"
            onClick={handleNewSession}
            type="button"
          >
            <span className="claude-panel-worktree-item-label">Current directory</span>
            <span className="claude-panel-worktree-item-hint">new session</span>
          </button>
          {loadingWorktrees && (
            <div className="claude-panel-worktree-loading">Loading worktrees...</div>
          )}
          {!loadingWorktrees && worktrees.length > 0 && (
            <>
              <div className="claude-panel-worktree-divider" />
              <div className="claude-panel-worktree-header">Worktrees</div>
              {worktrees.map((wt) => (
                <div key={wt.path} className="claude-panel-worktree-row">
                  <button
                    className="claude-panel-worktree-item"
                    onClick={() => handleWorktreeSelect(wt)}
                    type="button"
                  >
                    <span className="claude-panel-worktree-item-label">
                      {wt.branch ?? wt.path.split("/").pop()}
                    </span>
                    <span className="claude-panel-worktree-item-path">{wt.path}</span>
                  </button>
                  <button
                    className="claude-panel-worktree-remove"
                    onClick={(e) => handleRemoveWorktree(e, wt)}
                    title={`Remove worktree ${wt.branch ?? wt.path}`}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
