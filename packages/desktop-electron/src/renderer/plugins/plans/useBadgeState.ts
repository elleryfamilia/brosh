/**
 * Plans Badge State — Module-scoped cache + pure derivation
 *
 * Same pattern as docs/useBadgeState.ts: the badge state function must be
 * pure on WorkspaceContext, but plan count isn't part of WC. We use a
 * module-level cache that usePlansData updates.
 */

import type { WorkspaceContext, BadgeState } from '../types';

interface PlansBadgeCache {
  count: number;
  latestMtime: string | null;
  gitRoot: string;
}

let cache: PlansBadgeCache | null = null;
let pendingFetchRoot: string | null = null;

/** Called by usePlansData after each fetch to update the badge cache. */
export function updatePlansBadgeCache(count: number, latestMtime: string | null, gitRoot: string): void {
  cache = { count, latestMtime, gitRoot };
  pendingFetchRoot = null;
}

/** Kick off a background fetch to populate the cache. */
function lazyFetch(gitRoot: string): void {
  if (pendingFetchRoot === gitRoot) return;
  pendingFetchRoot = gitRoot;
  window.terminalAPI.getPlansForProject(gitRoot).then((result) => {
    const latestMtime = result.length > 0 ? result[0].mtime : null;
    updatePlansBadgeCache(result.length, latestMtime, gitRoot);
  });
}

const HIDDEN: BadgeState = { visible: false, label: '', tooltip: '', attention: false };

/** Pure derivation of badge state from WorkspaceContext + module cache. */
export function getPlansBadgeState(ctx: WorkspaceContext): BadgeState {
  if (!ctx.git) return HIDDEN;

  // Cache miss or stale — trigger lazy background fetch
  if (!cache || cache.gitRoot !== ctx.git.projectRoot) {
    lazyFetch(ctx.git.projectRoot);
    return HIDDEN;
  }

  // Always show badge in git projects so the panel is accessible
  const count = cache.count;
  const tooltip = count > 0
    ? `${count} plan file${count === 1 ? '' : 's'} for this project`
    : 'Click to index plans for this project';

  // Attention if most recent plan was modified < 1 hour ago
  let attention = false;
  if (cache.latestMtime) {
    const age = Date.now() - new Date(cache.latestMtime).getTime();
    attention = age < 60 * 60 * 1000;
  }

  return { visible: true, label: 'Plans', tooltip, attention };
}
