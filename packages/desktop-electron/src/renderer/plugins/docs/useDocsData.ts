/**
 * useDocsData Hook
 *
 * Fetches the list of markdown files from git, manages file content loading
 * and saving. Refreshes on git:changed, cwd-changed, and visibility change.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { updateDocsBadgeCache } from './useBadgeState';

export interface DocFile {
  /** Relative path from git root (e.g. "docs/api/setup.md") */
  relativePath: string;
  /** Directory component (e.g. "docs/api") or "" for root */
  dir: string;
  /** Filename only (e.g. "setup.md") */
  name: string;
}

interface UseDocsDataParams {
  /** Function to get focused terminal session ID without stale closures */
  getFocusedSessionId: () => string | null;
  /** Whether the docs sidebar is currently open */
  isActive: boolean;
  /** Current focused session ID — triggers re-fetch on change */
  focusedSessionId: string | null;
}

interface UseDocsDataResult {
  files: DocFile[];
  gitRoot: string | null;
  loading: boolean;
  /** Load a specific file's content */
  loadFile: (relativePath: string) => Promise<string | null>;
  /** Save content to a file */
  saveFile: (relativePath: string, content: string) => Promise<boolean>;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
}

function parseFiles(rawFiles: string[]): DocFile[] {
  return rawFiles.map((f) => {
    const lastSlash = f.lastIndexOf('/');
    return {
      relativePath: f,
      dir: lastSlash >= 0 ? f.slice(0, lastSlash) : '',
      name: lastSlash >= 0 ? f.slice(lastSlash + 1) : f,
    };
  });
}

export function useDocsData({
  getFocusedSessionId,
  isActive,
  focusedSessionId,
}: UseDocsDataParams): UseDocsDataResult {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [gitRoot, setGitRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const gitRootRef = useRef<string | null>(null);

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
      if (!cwd && gitRootRef.current) {
        cwd = gitRootRef.current;
      }

      setLoading(true);
      const result = await window.terminalAPI.gitListMarkdownFiles(cwd);

      if (result.success && result.root) {
        gitRootRef.current = result.root;
        setGitRoot(result.root);
        const parsed = parseFiles(result.files);
        setFiles(parsed);
        updateDocsBadgeCache(result.files.length, result.root);
      } else {
        gitRootRef.current = null;
        setGitRoot(null);
        setFiles([]);
      }
    } catch (err) {
      console.error('Failed to fetch markdown files:', err);
    } finally {
      setLoading(false);
    }
  }, [getFocusedSessionId]);

  const loadFile = useCallback(
    async (relativePath: string): Promise<string | null> => {
      const root = gitRootRef.current;
      if (!root) return null;
      try {
        const result = await window.terminalAPI.readFile(`${root}/${relativePath}`);
        return result.success && result.content != null ? result.content : null;
      } catch {
        return null;
      }
    },
    []
  );

  const saveFile = useCallback(
    async (relativePath: string, content: string): Promise<boolean> => {
      const root = gitRootRef.current;
      if (!root) return false;
      try {
        const result = await window.terminalAPI.writeFile(`${root}/${relativePath}`, content);
        return result.success;
      } catch {
        return false;
      }
    },
    []
  );

  // Re-fetch when focused session changes
  useEffect(() => {
    fetchFiles();
  }, [focusedSessionId, fetchFiles]);

  // Watchers + events
  useEffect(() => {
    const cleanupGitWatcher = window.terminalAPI.onGitChanged(() => {
      console.log('[docs] git changed, refreshing files');
      fetchFiles();
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
      if (!document.hidden) fetchFiles();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cleanupGitWatcher();
      cleanupTerminalEvents();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchFiles, getFocusedSessionId]);

  // Fetch when sidebar opens
  useEffect(() => {
    if (isActive) fetchFiles();
  }, [isActive, fetchFiles]);

  return { files, gitRoot, loading, loadFile, saveFile, refresh: fetchFiles };
}
