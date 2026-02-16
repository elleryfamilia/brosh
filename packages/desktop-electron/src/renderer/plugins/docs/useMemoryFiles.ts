/**
 * useMemoryFiles Hook
 *
 * Fetches Claude memory/context files (CLAUDE.md, rules, auto-memory)
 * via the context:discoverMemoryFiles IPC handler. Refreshes on
 * visibility change, sidebar activation, and focused session change.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MemoryFileInfo } from '../../types/electron';

interface UseMemoryFilesParams {
  getFocusedSessionId: () => string | null;
  isActive: boolean;
  focusedSessionId: string | null;
}

interface UseMemoryFilesResult {
  files: MemoryFileInfo[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useMemoryFiles({
  getFocusedSessionId,
  isActive,
  focusedSessionId,
}: UseMemoryFilesParams): UseMemoryFilesResult {
  const [files, setFiles] = useState<MemoryFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const hasFetchedRef = useRef(false);

  const fetchFiles = useCallback(async () => {
    try {
      let cwd: string | undefined;
      const sessionId = getFocusedSessionId();
      if (sessionId) {
        const cwdResult = await window.terminalAPI.getCwd(sessionId);
        if (cwdResult.success && cwdResult.cwd) {
          cwd = cwdResult.cwd;
        }
      }

      setLoading(true);
      const result = await window.terminalAPI.discoverMemoryFiles(cwd);

      if (result.success) {
        setFiles(result.files);
      } else {
        setFiles([]);
      }
      hasFetchedRef.current = true;
    } catch (err) {
      console.error('Failed to discover memory files:', err);
    } finally {
      setLoading(false);
    }
  }, [getFocusedSessionId]);

  // Re-fetch when focused session changes
  useEffect(() => {
    if (isActive) fetchFiles();
  }, [focusedSessionId, isActive, fetchFiles]);

  // Fetch when sidebar opens
  useEffect(() => {
    if (isActive) fetchFiles();
  }, [isActive, fetchFiles]);

  // Watchers + terminal events (mirrors useDocsData / useGitData)
  useEffect(() => {
    const cleanupGitWatcher = window.terminalAPI.onGitChanged(() => {
      if (isActive) fetchFiles();
    });

    const cleanupTerminalEvents = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as { type: string; sessionId?: string };
      const sessionId = getFocusedSessionId();
      if (msg.sessionId !== sessionId) return;
      if (msg.type === 'cwd-changed') {
        fetchFiles();
      }
    });

    const handleVisibilityChange = () => {
      if (!document.hidden && isActive) fetchFiles();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cleanupGitWatcher();
      cleanupTerminalEvents();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchFiles, getFocusedSessionId, isActive]);

  return { files, loading, refresh: fetchFiles };
}
