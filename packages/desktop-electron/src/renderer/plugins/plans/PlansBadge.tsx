/**
 * Plans Badge — Status bar badge for the plans plugin.
 */

import { PlansIcon } from './PlansIcon';
import { StatusBarBadge } from '../../components/smart-status-bar/StatusBarBadge';
import type { BadgeProps } from '../types';

export function PlansBadge({ state, isActive, onClick }: BadgeProps) {
  if (!state.visible) return null;

  return (
    <StatusBarBadge
      label={state.label}
      icon={<PlansIcon size={14} />}
      active={isActive}
      pulsing={state.attention}
      onClick={onClick}
      title={state.tooltip}
      className="plans-status-badge"
    />
  );
}
