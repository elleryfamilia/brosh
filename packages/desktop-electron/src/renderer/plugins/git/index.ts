/**
 * Git Plugin — Self-registration
 *
 * Registers the git sidebar plugin with the plugin system.
 * Import this module to activate the git plugin.
 */

import { registerSidebarPlugin } from '../registry';
import type { RegisteredPlugin } from '../types';
import { GitPluginBadge } from './GitBadge';
import { GitPanel } from './GitPanel';
import { getGitBadgeState } from './useBadgeState';

const gitPlugin: RegisteredPlugin = {
  definition: {
    id: 'git',
    name: 'Git',
    shortcut: { mod: true, shift: true, key: 'g' },
    badgeOrder: 0,
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 500,
    isRelevant: (ctx) => ctx.git !== null,
  },
  Badge: GitPluginBadge,
  Panel: GitPanel,
  getBadgeState: getGitBadgeState,
};

registerSidebarPlugin(gitPlugin);
