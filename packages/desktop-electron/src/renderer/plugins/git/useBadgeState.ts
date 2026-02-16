/**
 * Git Badge State — Pure derivation from WorkspaceContext
 */

import type { WorkspaceContext, BadgeState } from '../types';

export function getGitBadgeState(ctx: WorkspaceContext): BadgeState {
  if (!ctx.git || !ctx.git.status.branch) {
    return { visible: false, label: '', tooltip: '', attention: false };
  }

  const { branch, dirty, ahead, behind } = ctx.git.status;

  // Build label
  const label = 'Git';

  // Build tooltip
  const syncParts: string[] = [];
  if (ahead > 0) syncParts.push(`${ahead} ahead`);
  if (behind > 0) syncParts.push(`${behind} behind`);
  const syncInfo = syncParts.length > 0 ? ` (${syncParts.join(', ')})` : '';
  const tooltip = `Branch: ${branch}${syncInfo}${dirty ? ' (uncommitted changes)' : ''}`;

  return {
    visible: true,
    label,
    tooltip,
    attention: dirty,
  };
}
