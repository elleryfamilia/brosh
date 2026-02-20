/**
 * Files Badge — Status bar badge for the files plugin.
 */

import { FilesIcon } from './FilesIcon';
import { StatusBarBadge } from '../../components/smart-status-bar/StatusBarBadge';
import type { BadgeProps } from '../types';

export function FilesBadge({ state, isActive, onClick }: BadgeProps) {
  if (!state.visible) return null;

  return (
    <StatusBarBadge
      label={state.label}
      icon={<FilesIcon size={14} />}
      active={isActive}
      onClick={onClick}
      title={state.tooltip}
      className="files-status-badge"
    />
  );
}
