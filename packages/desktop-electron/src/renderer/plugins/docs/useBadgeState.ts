/**
 * Agent Context Badge State — Module-scoped cache + pure derivation
 *
 * The badge state function must be pure on WorkspaceContext, but the doc count
 * isn't part of WC. We use a module-level cache that useDocsData updates.
 *
 * Because SmartStatusBar skips rendering Badge components when state.visible
 * is false, we trigger a lazy background fetch from getDocsBadgeState itself
 * on cache miss so the cache gets populated for the next render cycle.
 */

import type { WorkspaceContext, BadgeState } from '../types';

interface DocsBadgeCache {
  count: number;
  gitRoot: string;
}

let cache: DocsBadgeCache | null = null;
let pendingFetchRoot: string | null = null;

/** Called by useDocsData after each fetch to update the badge cache. */
export function updateDocsBadgeCache(count: number, gitRoot: string): void {
  cache = { count, gitRoot };
  pendingFetchRoot = null;
}

/** Kick off a background fetch to populate the cache. */
function lazyFetch(gitRoot: string): void {
  if (pendingFetchRoot === gitRoot) return;
  pendingFetchRoot = gitRoot;
  window.terminalAPI.gitListMarkdownFiles(gitRoot).then((result) => {
    if (result.success && result.root) {
      updateDocsBadgeCache(result.files.length, result.root);
    }
  });
}

const HIDDEN: BadgeState = { visible: false, label: '', tooltip: '', attention: false };

/** Pure derivation of badge state from WorkspaceContext + module cache. */
export function getDocsBadgeState(ctx: WorkspaceContext): BadgeState {
  if (!ctx.git) return HIDDEN;

  // Cache miss or stale — trigger lazy background fetch
  if (!cache || cache.gitRoot !== ctx.git.projectRoot) {
    lazyFetch(ctx.git.projectRoot);
    return HIDDEN;
  }

  if (cache.count === 0) return HIDDEN;

  return {
    visible: true,
    label: 'Context',
    tooltip: `${cache.count} markdown file${cache.count === 1 ? '' : 's'} in repository`,
    attention: false,
  };
}
