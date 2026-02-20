/**
 * Files Badge State — Pure derivation from WorkspaceContext
 *
 * Always visible when a cwd is present.
 */

import type { WorkspaceContext, BadgeState } from '../types';

const HIDDEN: BadgeState = { visible: false, label: '', tooltip: '', attention: false };

export function getFilesBadgeState(_ctx: WorkspaceContext): BadgeState {
  return {
    visible: true,
    label: 'Files',
    tooltip: 'Browse project files',
    attention: false,
  };
}
