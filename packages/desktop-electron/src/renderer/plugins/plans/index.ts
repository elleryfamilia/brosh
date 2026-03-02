/**
 * Plans Plugin — Self-registration
 *
 * Registers the plans sidebar plugin with the plugin system.
 * Import this module to activate the plugin.
 */

import { lazy } from 'react';
import { registerSidebarPlugin } from '../registry';
import type { RegisteredPlugin } from '../types';
import { PlansBadge } from './PlansBadge';
import { getPlansBadgeState } from './useBadgeState';

const PlansPanel = lazy(() => import('./PlansPanel').then(m => ({ default: m.PlansPanel })));
const PlansEditorPanel = lazy(() => import('./PlansEditorPanel').then(m => ({ default: m.PlansEditorPanel })));

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
