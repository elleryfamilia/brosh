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

  // Fetch when sidebar opens or git root changes
  useEffect(() => {
    if (isActive) fetchPlans();
  }, [isActive, gitRoot, fetchPlans]);

  // Re-fetch when focused session changes
  useEffect(() => {
    if (isActive) fetchPlans();
  }, [focusedSessionId, isActive, fetchPlans]);

  // Listen for plan changes, cwd changes, git changes
  useEffect(() => {
    const cleanupPlanWatcher = window.terminalAPI.onPlanChanged(() => {
      if (isActive) fetchPlans();
    });

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

    const handleVisibilityChange = () => {
      if (!document.hidden && isActive) fetchPlans();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cleanupPlanWatcher();
      cleanupGitWatcher();
      cleanupTerminalEvents();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchPlans, getFocusedSessionId, isActive]);

  return { plans, loading, indexing, refresh: fetchPlans, indexPlans, dismissPlan, resetIndex };
}
