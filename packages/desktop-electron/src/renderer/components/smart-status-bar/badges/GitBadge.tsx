/**
 * Git Badge Component
 *
 * Shows git branch and dirty state when in a repository.
 */

import { GitIcon } from '../../icons/GitIcon';
import { StatusBarBadge } from '../StatusBarBadge';
import type { GitStatus } from '../types';

interface GitBadgeProps {
  status: GitStatus | null;
  isActive?: boolean;
  onClick: () => void;
}

export function GitBadge({ status, isActive = false, onClick }: GitBadgeProps) {
  if (!status || !status.branch) {
    return null;
  }

  const { branch, dirty, ahead, behind } = status;

  // Build label
  let label = branch;
  if (dirty) {
    label += ' \u25CF'; // bullet for dirty
  }

  // Build sync info for title
  const syncParts: string[] = [];
  if (ahead > 0) {
    syncParts.push(`${ahead} ahead`);
  }
  if (behind > 0) {
    syncParts.push(`${behind} behind`);
  }
  const syncInfo = syncParts.length > 0 ? ` (${syncParts.join(', ')})` : '';

  return (
    <StatusBarBadge
      label={label}
      icon={<GitIcon size={16} />}
      active={isActive}
      onClick={onClick}
      title={`Branch: ${branch}${syncInfo}${dirty ? ' (uncommitted changes)' : ''}`}
      className="git-status-badge"
    />
  );
}
