/**
 * Agent Context Badge State
 *
 * Fetches markdown file count directly from main process.
 * The badge is always visible in git projects - content is secondary.
 */

import type { WorkspaceContext, BadgeState } from '../types';

const HIDDEN: BadgeState = { visible: false, label: '', tooltip: '', attention: false };

/** Track in-flight requests to avoid duplicate calls */
let pendingFetch: Promise<number> | null = null;
let cachedCount: number | null = null;
let cachedGitRoot: string | null = null;

/** Fetch markdown file count from main process */
async function fetchMarkdownCount(gitRoot: string): Promise<number> {
  // Return cached if already fetched for this root
  if (cachedGitRoot === gitRoot && cachedCount !== null) {
    return cachedCount;
  }

  // Avoid duplicate requests
  if (!pendingFetch) {
    pendingFetch = window.terminalAPI.gitListMarkdownFiles(gitRoot).then((result) => {
      const count = result.success ? result.files.length : 0;
      cachedCount = count;
      cachedGitRoot = gitRoot;
      pendingFetch = null;
      return count;
    });
  }

  return pendingFetch;
}

/** Badge state derivation - always shows badge in git projects */
export function getDocsBadgeState(ctx: WorkspaceContext): BadgeState {
  console.log('[docs-badge] called with ctx.git:', !!ctx.git, 'projectRoot:', ctx.git?.projectRoot);
  if (!ctx.git) {
    console.log('[docs-badge] no git context, returning HIDDEN');
    return HIDDEN;
  }

  const gitRoot = ctx.git.projectRoot;
  console.log('[docs-badge] gitRoot:', gitRoot, 'cachedGitRoot:', cachedGitRoot, 'cachedCount:', cachedCount);

  // Synchronously return visible: true immediately
  // The count will update on next workspace change (e.g., git init detected)
  // This ensures the badge appears right away even before first fetch
  if (cachedGitRoot !== gitRoot) {
    // New git root - trigger fetch but show badge immediately
    fetchMarkdownCount(gitRoot).catch(() => {});

    return {
      visible: true,
      label: 'Context',
      tooltip: 'Loading...',
      attention: false,
    };
  }

  // Return cached count
  const count = cachedCount ?? 0;

  if (count === 0) {
    return {
      visible: true,
      label: 'Context',
      tooltip: 'No markdown files in repository',
      attention: false,
    };
  }

  return {
    visible: true,
    label: 'Context',
    tooltip: `${count} markdown file${count === 1 ? '' : 's'} in repository`,
    attention: false,
  };
}

/** Legacy export for useDocsData to update cache */
export function updateDocsBadgeCache(count: number, gitRoot: string): void {
  cachedCount = count;
  cachedGitRoot = gitRoot;
}
