/**
 * CommitFileItem Component
 *
 * Single file row inside an expanded commit card.
 * Shows status icon, path, and +/- line stats.
 */

import type { GitCommitFile } from "../smart-status-bar/types";
import { FileStatusIcon } from "./icons";

interface CommitFileItemProps {
  file: GitCommitFile;
  onClick?: () => void;
}

function formatPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return { dir: "", name: filePath };
  return {
    dir: filePath.substring(0, lastSlash + 1),
    name: filePath.substring(lastSlash + 1),
  };
}

export function CommitFileItem({ file, onClick }: CommitFileItemProps) {
  const { dir, name } = formatPath(file.path);
  const hasStats = file.additions > 0 || file.deletions > 0;

  return (
    <div
      className={`git-sidebar-commit-file${onClick ? " clickable" : ""}`}
      onClick={onClick}
    >
      <FileStatusIcon status={file.status} size={14} />
      <span className="git-sidebar-commit-file-path" title={file.path}>
        <span className="git-sidebar-file-path-inner">
          {dir && <span className="git-sidebar-file-dir">{dir}</span>}
          {name}
        </span>
      </span>
      {hasStats && (
        <span className="git-sidebar-commit-file-stats">
          {file.additions > 0 && (
            <span style={{ color: "var(--status-success)" }}>+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && " "}
          {file.deletions > 0 && (
            <span style={{ color: "var(--status-error)" }}>-{file.deletions}</span>
          )}
        </span>
      )}
    </div>
  );
}
