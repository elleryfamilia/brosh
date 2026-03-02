/**
 * Agent Context Plugin — Self-registration
 *
 * Registers the agent context sidebar plugin with the plugin system.
 * Import this module to activate the plugin.
 */

import { lazy } from 'react';
import { registerSidebarPlugin } from '../registry';
import type { RegisteredPlugin } from '../types';
import { DocsBadge } from './DocsBadge';
import { getDocsBadgeState } from './useBadgeState';

const DocsPanel = lazy(() => import('./DocsPanel').then(m => ({ default: m.DocsPanel })));
const DocsEditorPanel = lazy(() => import('./DocsEditorPanel').then(m => ({ default: m.DocsEditorPanel })));

const docsPlugin: RegisteredPlugin = {
  definition: {
    id: 'docs',
    name: 'Agent Context',
    shortcut: { mod: true, shift: true, key: 'e' },
    badgeOrder: 1,
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 500,
    isRelevant: (ctx) => ctx.git !== null,
  },
  Badge: DocsBadge,
  Panel: DocsPanel,
  EditorPanel: DocsEditorPanel,
  getBadgeState: getDocsBadgeState,
};

registerSidebarPlugin(docsPlugin);
