/**
 * Git Badge — Plugin adapter for the existing GitBadge component.
 *
 * Maps the plugin BadgeProps to the existing GitBadge's props.
 */

import { GitIcon } from '../../components/icons/GitIcon';
import { StatusBarBadge } from '../../components/smart-status-bar/StatusBarBadge';
import type { BadgeProps } from '../types';

export function GitPluginBadge({ state, isActive, onClick }: BadgeProps) {
  if (!state.visible) return null;

  return (
    <StatusBarBadge
      label={state.label}
      icon={<GitIcon size={14} />}
      active={isActive}
      onClick={onClick}
      title={state.tooltip}
      className="git-status-badge"
    />
  );
}
