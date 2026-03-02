/**
 * Files Plugin — Self-registration
 *
 * Registers the file browser sidebar plugin with the plugin system.
 * Import this module to activate the plugin.
 */

import { lazy } from 'react';
import { registerSidebarPlugin } from '../registry';
import type { RegisteredPlugin } from '../types';
import { FilesBadge } from './FilesBadge';
import { getFilesBadgeState } from './useBadgeState';

const FilesPanel = lazy(() => import('./FilesPanel').then(m => ({ default: m.FilesPanel })));
const FilesEditorPanel = lazy(() => import('./FilesEditorPanel').then(m => ({ default: m.FilesEditorPanel })));

const filesPlugin: RegisteredPlugin = {
  definition: {
    id: 'files',
    name: 'Files',
    shortcut: { mod: true, shift: true, key: 'f' },
    badgeOrder: 3,
    defaultWidth: 220,
    minWidth: 160,
    maxWidth: 400,
    isRelevant: () => true,
  },
  Badge: FilesBadge,
  Panel: FilesPanel,
  EditorPanel: FilesEditorPanel,
  getBadgeState: getFilesBadgeState,
};

registerSidebarPlugin(filesPlugin);
