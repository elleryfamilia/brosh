/**
 * Agent Context Badge — Status bar badge for the agent context plugin.
 *
 * Initial cache population is handled by the lazy fetch in useBadgeState,
 * so this component just renders when state.visible is true.
 */

import { DocsIcon } from './DocsIcon';
import { StatusBarBadge } from '../../components/smart-status-bar/StatusBarBadge';
import type { BadgeProps } from '../types';

export function DocsBadge({ state, isActive, onClick }: BadgeProps) {
  if (!state.visible) return null;

  return (
    <StatusBarBadge
      label={state.label}
      icon={<DocsIcon size={14} />}
      active={isActive}
      onClick={onClick}
      title={state.tooltip}
      className="docs-status-badge"
    />
  );
}
