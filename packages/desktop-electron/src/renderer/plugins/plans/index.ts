/**
 * Plans Plugin — Self-registration
 *
 * Registers the plans sidebar plugin with the plugin system.
 * Import this module to activate the plugin.
 */

import { registerSidebarPlugin } from '../registry';
import type { RegisteredPlugin } from '../types';
import { PlansBadge } from './PlansBadge';
import { PlansPanel } from './PlansPanel';
import { PlansEditorPanel } from './PlansEditorPanel';
import { getPlansBadgeState } from './useBadgeState';

const plansPlugin: RegisteredPlugin = {
  definition: {
    id: 'plans',
    name: 'Plans',
    shortcut: { mod: true, shift: true, key: 'p' },
    badgeOrder: 2,
    defaultWidth: 300,
    minWidth: 220,
    maxWidth: 500,
    isRelevant: (ctx) => ctx.git !== null,
  },
  Badge: PlansBadge,
  Panel: PlansPanel,
  EditorPanel: PlansEditorPanel,
  getBadgeState: getPlansBadgeState,
};

registerSidebarPlugin(plansPlugin);
