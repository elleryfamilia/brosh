/**
 * usePlansData Hook
 *
 * Fetches Claude Code plan files associated with the current project
 * via IPC. Refreshes on plan watcher events, cwd changes, and git changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlanFileInfo } from '../../types/electron';
import { updatePlansBadgeCache } from './useBadgeState';

interface UsePlansDataParams {
  getFocusedSessionId: () => string | null;
  isActive: boolean;
  focusedSessionId: string | null;
  gitRoot: string | null;
}

interface UsePlansDataResult {
  plans: PlanFileInfo[];
  loading: boolean;
  indexing: boolean;
  hasIndexed: boolean;
  refresh: () => Promise<void>;
  indexPlans: () => Promise<void>;
  dismissPlan: (filename: string) => Promise<void>;
  resetIndex: () => Promise<void>;
}

export function usePlansData({
  getFocusedSessionId,
  isActive,
  focusedSessionId,
  gitRoot,
}: UsePlansDataParams): UsePlansDataResult {
  const [plans, setPlans] = useState<PlanFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  // Tracks whether indexing has been attempted at least once for the current project
  const [hasIndexed, setHasIndexed] = useState(false);

  const fetchPlans = useCallback(async () => {
    if (!gitRoot) {
      setPlans([]);
      updatePlansBadgeCache(0, null, '');
      return;
    }

    try {
      setLoading(true);
      const result = await window.terminalAPI.getPlansForProject(gitRoot);
      setPlans(result);
      const latestMtime = result.length > 0 ? result[0].mtime : null;
      updatePlansBadgeCache(result.length, latestMtime, gitRoot);
    } catch (err) {
      console.error('Failed to fetch plans:', err);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [gitRoot]);

  const indexPlans = useCallback(async () => {
    if (!gitRoot) return;

    try {
      setIndexing(true);
      const result = await window.terminalAPI.indexPlansForProject(gitRoot);
      setPlans(result);
      setHasIndexed(true);
      const latestMtime = result.length > 0 ? result[0].mtime : null;
      updatePlansBadgeCache(result.length, latestMtime, gitRoot);
    } catch (err) {
      console.error('Failed to index plans:', err);
    } finally {
      setIndexing(false);
    }
  }, [gitRoot]);

  const dismissPlan = useCallback(async (filename: string) => {
    if (!gitRoot) return;

    try {
      const result = await window.terminalAPI.dismissPlan(gitRoot, filename);
      setPlans(result);
      const latestMtime = result.length > 0 ? result[0].mtime : null;
      updatePlansBadgeCache(result.length, latestMtime, gitRoot);
    } catch (err) {
      console.error('Failed to dismiss plan:', err);
    }
  }, [gitRoot]);

  const resetIndex = useCallback(async () => {
    if (!gitRoot) return;

    try {
      const result = await window.terminalAPI.resetPlanIndex(gitRoot);
      setPlans(result);
      const latestMtime = result.length > 0 ? result[0].mtime : null;
      updatePlansBadgeCache(result.length, latestMtime, gitRoot);
    } catch (err) {
      console.error('Failed to reset plan index:', err);
    }
  }, [gitRoot]);

  // Reset hasIndexed when project changes (each project has its own classification)
  useEffect(() => {
    setHasIndexed(false);
  }, [gitRoot]);

  // Fetch when sidebar opens or git root changes
  useEffect(() => {
    if (!isActive || !gitRoot) return;
    fetchPlans();
  }, [isActive, gitRoot, fetchPlans]);

  // Re-fetch when focused session changes
  useEffect(() => {
    if (isActive) fetchPlans();
  }, [focusedSessionId, isActive, fetchPlans]);

  // Poll plans directory on a 5s interval (only when panel is active + visible).
  // The main process persistently tracks which plans have been classified for each
  // project, so we just need to trigger indexPlansForProject when new files appear.
  useEffect(() => {
    if (!isActive) return;

    console.log('[plans-poll] starting (gitRoot=%s, hidden=%s)', gitRoot, document.hidden);
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const diff = await window.terminalAPI.pollPlansDirectory();
        const hasChanges = diff.changedFiles.length > 0 || diff.deletedFiles.length > 0;
        const hasNew = diff.newFiles.length > 0;

        if (hasNew || hasChanges) {
          console.log('[plans-poll] diff:', diff);
        }

        if (hasNew || hasChanges) {
          // New or changed files — refresh the list (user can manually index if needed)
          fetchPlans();
        }
      } catch (err) {
        console.error('[plans-poll] poll failed:', err);
      }
    };

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(poll, 5000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        poll(); // Immediate poll on becoming visible
        startPolling();
      }
    };

    const handleFocus = () => {
      // Check for new plans when app gets focus (user switches back to Brosh)
      if (isActive && gitRoot) {
        console.log('[plans] app focused, checking for new plans');
        poll();
      }
    };

    // Start polling immediately if visible, with an immediate first poll
    if (!document.hidden) {
      poll();
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      console.log('[plans-poll] stopping');
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isActive, gitRoot, fetchPlans]);

  // Listen for git changes and cwd changes
  useEffect(() => {
    const cleanupGitWatcher = window.terminalAPI.onGitChanged(() => {
      if (isActive) fetchPlans();
    });

    const cleanupTerminalEvents = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as { type: string; sessionId?: string };
      const sessionId = getFocusedSessionId();
      if (msg.sessionId !== sessionId) return;
      if (msg.type === 'cwd-changed') {
        fetchPlans();
      }
    });

    return () => {
      cleanupGitWatcher();
      cleanupTerminalEvents();
    };
  }, [fetchPlans, getFocusedSessionId, isActive]);

  return { plans, loading, indexing, hasIndexed, refresh: fetchPlans, indexPlans, dismissPlan, resetIndex };
}
