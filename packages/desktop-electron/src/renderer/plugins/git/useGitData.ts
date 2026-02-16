/**
 * useGitData Hook
 *
 * Extracts ALL git fetch/poll/watcher logic that was previously in App.tsx.
 * Owns git status + commit data lifecycle.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GitStatus, GitCommit } from '../../components/smart-status-bar/types';

interface UseGitDataParams {
  /** Function to get focused terminal session ID without stale closures */
  getFocusedSessionId: () => string | null;
  /** Whether the git sidebar is currently open */
  isActive: boolean;
  /** Current focused session ID — used as signal to re-fetch when focus changes */
  focusedSessionId: string | null;
}

interface UseGitDataResult {
  gitStatus: GitStatus | null;
  gitCommits: GitCommit[] | null;
  projectRoot: string | null;
  fetchGitStatus: () => Promise<void>;
  fetchGitCommits: () => Promise<void>;
}

export function useGitData({ getFocusedSessionId, isActive, focusedSessionId }: UseGitDataParams): UseGitDataResult {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitCommits, setGitCommits] = useState<GitCommit[] | null>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const projectRootRef = useRef<string | null>(null);

  const fetchGitStatus = useCallback(async () => {
    try {
      let cwd: string | undefined;
      const sessionId = getFocusedSessionId();
      if (sessionId) {
        const cwdResult = await window.terminalAPI.getCwd(sessionId);
        if (cwdResult.success && cwdResult.cwd) {
          cwd = cwdResult.cwd;
        }
      }
      // When no terminal is focused (e.g. editor pane), use last known
      // project root so git paths stay consistent.
      if (!cwd && projectRootRef.current) {
        cwd = projectRootRef.current;
      }

      // No terminal focused and no previous project root — skip fetch to
      // avoid using Electron's process CWD which causes badge flash.
      if (!cwd) return;

      const [status, rootResult] = await Promise.all([
        window.terminalAPI.getGitStatus(cwd),
        window.terminalAPI.getGitRoot(cwd),
      ]);

      if (rootResult.success && rootResult.root) {
        if (projectRootRef.current !== rootResult.root) {
          setProjectRoot(rootResult.root);
        }
        projectRootRef.current = rootResult.root;
      } else {
        // Not inside a git repo — clear status so the badge disappears
        projectRootRef.current = null;
        setProjectRoot(null);
        setGitStatus(null);
        setGitCommits(null);
        return;
      }

      if (status) {
        setGitStatus({
          branch: status.branch,
          dirty: status.dirty,
          ahead: status.ahead,
          behind: status.behind,
          files: status.files,
        });
      }
      // When status is null but root exists, keep previous gitStatus to avoid
      // layout shifts during transient git failures (e.g. index.lock).
    } catch (err) {
      console.error('Failed to fetch git status:', err);
      // Keep previous gitStatus to avoid layout shifts (terminal resize flash)
    }
  }, [getFocusedSessionId]);

  const fetchGitCommits = useCallback(async () => {
    try {
      let cwd: string | undefined;
      const sessionId = getFocusedSessionId();
      if (sessionId) {
        const cwdResult = await window.terminalAPI.getCwd(sessionId);
        if (cwdResult.success && cwdResult.cwd) {
          cwd = cwdResult.cwd;
        }
      }
      if (!cwd && projectRootRef.current) {
        cwd = projectRootRef.current;
      }

      // No terminal focused and no previous project root — skip fetch.
      if (!cwd) return;

      // Verify we're in a git repo before fetching commits
      const rootResult = await window.terminalAPI.getGitRoot(cwd);
      if (!rootResult.success || !rootResult.root) {
        setGitCommits(null);
        return;
      }

      const commits = await window.terminalAPI.getGitCommits(rootResult.root);
      if (commits) {
        setGitCommits(commits as GitCommit[]);
      } else {
        setGitCommits([]);
      }
    } catch (err) {
      console.error('Failed to fetch git commits:', err);
    }
  }, [getFocusedSessionId]);

  // Re-fetch when focused session changes (tab switch, pane focus)
  useEffect(() => {
    fetchGitStatus();
    fetchGitCommits();
  }, [focusedSessionId, fetchGitStatus, fetchGitCommits]);

  // Poll + watchers + terminal events
  useEffect(() => {
    const cleanupGitWatcher = window.terminalAPI.onGitChanged(() => {
      fetchGitStatus();
    });

    // Poll git status every 3s so external edits (Claude Code, other editors)
    // are detected without relying on file watchers.
    const pollInterval = setInterval(() => {
      fetchGitStatus();
    }, 3000);

    const cleanupTerminalEvents = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as {
        type: string;
        sessionId?: string;
        cwd?: string;
        mark?: { type: string };
      };

      const sessionId = getFocusedSessionId();
      if (msg.sessionId !== sessionId) return;

      if (msg.type === 'cwd-changed') {
        fetchGitStatus();
        fetchGitCommits();
        return;
      }

      if (msg.type === 'command-mark' && msg.mark?.type === 'command-end') {
        fetchGitStatus();
        fetchGitCommits();
      }
    });

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchGitStatus();
        fetchGitCommits();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cleanupGitWatcher();
      clearInterval(pollInterval);
      cleanupTerminalEvents();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchGitStatus, fetchGitCommits, getFocusedSessionId]);

  // Fetch commits when sidebar opens
  useEffect(() => {
    if (isActive) {
      fetchGitCommits();
    }
  }, [isActive, fetchGitCommits]);

  return { gitStatus, gitCommits, projectRoot, fetchGitStatus, fetchGitCommits };
}
