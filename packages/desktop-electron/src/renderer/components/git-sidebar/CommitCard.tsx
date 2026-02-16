/**
 * CommitCard Component
 *
 * Accordion card showing a single commit with a git graph rail on the left,
 * commit message, author, and relative time. Expands to reveal per-file change stats.
 * The graph cell spans the full card height (including expanded files).
 */

import { useState, useCallback } from "react";
import type { GitCommit } from "../smart-status-bar/types";
import type { GraphRow } from "./graph-layout";
import { CommitGraphCell } from "./CommitGraphCell";
import { CommitFileItem } from "./CommitFileItem";
import { timeAgo } from "./time-ago";

interface CommitCardProps {
  commit: GitCommit;
  graphRow?: GraphRow;
  onFileSelect?: (path: string, commitHash?: string) => void;
}

export function CommitCard({ commit, graphRow, onFileSelect }: CommitCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="git-sidebar-commit-card">
      <div className="git-sidebar-commit-card-row">
        {graphRow && <CommitGraphCell row={graphRow} />}
        <div className="git-sidebar-commit-card-content">
          <div
            className="git-sidebar-commit-card-header"
            onClick={toggleExpanded}
          >
            <div className="git-sidebar-commit-card-info">
              <span className={`git-sidebar-commit-message${expanded ? " expanded" : ""}`} title={expanded ? undefined : commit.message}>
                {commit.message}
              </span>
              <span className="git-sidebar-commit-meta">
                {commit.author} &middot; {timeAgo(commit.date)}
              </span>
            </div>
            {commit.files.length > 0 && (
              <span className="git-sidebar-commit-file-count">
                {commit.files.length}
              </span>
            )}
          </div>
          {expanded && commit.files.length > 0 && (
            <div className="git-sidebar-commit-card-files">
              {commit.files.map((file) => (
                <CommitFileItem
                  key={file.path}
                  file={file}
                  onClick={onFileSelect ? () => onFileSelect(file.path, commit.hash) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
