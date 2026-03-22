/**
 * useFilesData Hook
 *
 * Manages the lazy-loaded directory tree state and CRUD operations
 * for the Files plugin sidebar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  /** Absolute path */
  path: string;
  /** True if the entry is gitignored */
  isIgnored?: boolean;
}

/** Entries that should never appear in the tree (not useful to browse) */
const DENY_LIST = new Set([
  '.git',
  '.DS_Store',
  'Thumbs.db',
]);

interface UseFilesDataParams {
  isActive: boolean;
  cwd: string | null;
  gitRoot: string | null;
}

interface UseFilesDataResult {
  /** Map of expanded directory paths to their entries */
  expandedDirs: Map<string, DirEntry[]>;
  /** Root directory path */
  root: string | null;
  /** Root entries (top-level) */
  rootEntries: DirEntry[];
  loading: boolean;
  expandDir: (dirPath: string) => Promise<void>;
  collapseDir: (dirPath: string) => void;
  toggleDir: (dirPath: string) => void;
  createFile: (parentDir: string, name: string) => Promise<boolean>;
  createFolder: (parentDir: string, name: string) => Promise<boolean>;
  refreshDir: (dirPath: string) => Promise<void>;
  renameEntry: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteEntry: (entryPath: string) => Promise<boolean>;
  moveEntry: (srcPath: string, destDir: string) => Promise<boolean>;
}

async function fetchDirEntries(dirPath: string): Promise<DirEntry[]> {
  const result = await window.terminalAPI.readDir(dirPath);
  if (!result.success || !result.entries) return [];

  const entries: DirEntry[] = result.entries
    .filter((e) => !DENY_LIST.has(e.name))
    .map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory,
      isFile: e.isFile,
      path: `${dirPath}/${e.name}`,
    }));

  // Tag gitignored entries so the UI can dim them
  const paths = entries.map((e) => e.path);
  try {
    const ignoreResult = await window.terminalAPI.gitCheckIgnore(paths);
    if (ignoreResult.success && ignoreResult.ignored.length > 0) {
      const ignoredSet = new Set(ignoreResult.ignored);
      for (const entry of entries) {
        if (ignoredSet.has(entry.path)) {
          entry.isIgnored = true;
        }
      }
    }
  } catch {
    // Not in a git repo or git not available — leave entries as-is
  }

  return entries;
}

export function useFilesData({
  isActive,
  cwd,
  gitRoot,
}: UseFilesDataParams): UseFilesDataResult {
  const [expandedDirs, setExpandedDirs] = useState<Map<string, DirEntry[]>>(new Map());
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const root = gitRoot || cwd;
  const prevRoot = useRef<string | null>(null);

  // Load root directory when it changes or sidebar opens
  useEffect(() => {
    if (!isActive || !root) return;
    if (prevRoot.current === root) return;
    prevRoot.current = root;

    setLoading(true);
    setExpandedDirs(new Map());
    fetchDirEntries(root)
      .then((entries) => setRootEntries(entries))
      .catch(() => setRootEntries([]))
      .finally(() => setLoading(false));
  }, [isActive, root]);

  const expandDir = useCallback(async (dirPath: string) => {
    const entries = await fetchDirEntries(dirPath);
    setExpandedDirs((prev) => {
      const next = new Map(prev);
      next.set(dirPath, entries);
      return next;
    });
  }, []);

  const collapseDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Map(prev);
      // Remove this dir and any children
      for (const key of next.keys()) {
        if (key === dirPath || key.startsWith(dirPath + '/')) {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  const toggleDir = useCallback((dirPath: string) => {
    // Read current state synchronously to decide expand vs collapse
    setExpandedDirs((prev) => {
      if (prev.has(dirPath)) {
        // Collapse — remove this dir and any children
        const next = new Map(prev);
        for (const key of next.keys()) {
          if (key === dirPath || key.startsWith(dirPath + '/')) {
            next.delete(key);
          }
        }
        return next;
      }
      // Not expanded — trigger async load outside of setState
      fetchDirEntries(dirPath).then((entries) => {
        setExpandedDirs((p) => {
          const next = new Map(p);
          next.set(dirPath, entries);
          return next;
        });
      });
      return prev;
    });
  }, []);

  const refreshDir = useCallback(async (dirPath: string) => {
    if (dirPath === root) {
      const entries = await fetchDirEntries(dirPath);
      setRootEntries(entries);
    }
    // Re-fetch this directory and all expanded descendants so the
    // entire visible subtree is up-to-date after a refresh.
    setExpandedDirs((prev) => {
      const toRefresh = Array.from(prev.keys()).filter(
        (key) => key === dirPath || key.startsWith(dirPath + '/')
      );
      if (toRefresh.length === 0) return prev;

      Promise.all(
        toRefresh.map(async (dir) => {
          const entries = await fetchDirEntries(dir);
          return [dir, entries] as const;
        })
      ).then((results) => {
        setExpandedDirs((p) => {
          const next = new Map(p);
          for (const [dir, entries] of results) {
            // Only update dirs still expanded (user may have collapsed while fetching)
            if (next.has(dir)) {
              next.set(dir, entries);
            }
          }
          return next;
        });
      });
      return prev;
    });
  }, [root]);

  const createFile = useCallback(async (parentDir: string, name: string): Promise<boolean> => {
    const filePath = `${parentDir}/${name}`;
    const result = await window.terminalAPI.writeFile(filePath, '');
    if (result.success) {
      await refreshDir(parentDir);
    }
    return result.success;
  }, [refreshDir]);

  const createFolder = useCallback(async (parentDir: string, name: string): Promise<boolean> => {
    const dirPath = `${parentDir}/${name}`;
    const result = await window.terminalAPI.mkDir(dirPath);
    if (result.success) {
      await refreshDir(parentDir);
    }
    return result.success;
  }, [refreshDir]);

  const renameEntry = useCallback(async (oldPath: string, newPath: string): Promise<boolean> => {
    const result = await window.terminalAPI.renameFile(oldPath, newPath);
    if (result.success) {
      // Refresh parent directories of both old and new paths
      const oldParent = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newParent = newPath.substring(0, newPath.lastIndexOf('/'));
      await refreshDir(oldParent);
      if (newParent !== oldParent) await refreshDir(newParent);
    }
    return result.success;
  }, [refreshDir]);

  const deleteEntry = useCallback(async (entryPath: string): Promise<boolean> => {
    const result = await window.terminalAPI.trashItem(entryPath);
    if (result.success) {
      const parentDir = entryPath.substring(0, entryPath.lastIndexOf('/'));
      await refreshDir(parentDir);
    }
    return result.success;
  }, [refreshDir]);

  const moveEntry = useCallback(async (srcPath: string, destDir: string): Promise<boolean> => {
    const name = srcPath.split('/').pop() ?? '';
    const newPath = `${destDir}/${name}`;
    if (srcPath === newPath) return false;
    const result = await window.terminalAPI.renameFile(srcPath, newPath);
    if (result.success) {
      const srcParent = srcPath.substring(0, srcPath.lastIndexOf('/'));
      await refreshDir(srcParent);
      if (destDir !== srcParent) await refreshDir(destDir);
    }
    return result.success;
  }, [refreshDir]);

  // --- File watcher lifecycle ---
  // Active only when: plugin is open AND window is focused AND document is visible.
  // The main process additionally pauses on system suspend/lock.
  const watchActiveRef = useRef(false);

  // Compute the list of directories the main process should watch
  const getWatchDirs = useCallback((): string[] => {
    if (!root) return [];
    return [root, ...expandedDirs.keys()];
  }, [root, expandedDirs]);

  // Start or stop watching based on conditions
  const syncWatcher = useCallback(() => {
    const shouldWatch = isActive && document.hasFocus() && !document.hidden && !!root;
    if (shouldWatch && !watchActiveRef.current) {
      watchActiveRef.current = true;
      window.terminalAPI.fileWatchDirs(getWatchDirs());
    } else if (shouldWatch && watchActiveRef.current) {
      // Conditions still met — update the dir list (expand/collapse changed it)
      window.terminalAPI.fileWatchDirs(getWatchDirs());
    } else if (!shouldWatch && watchActiveRef.current) {
      watchActiveRef.current = false;
      window.terminalAPI.fileWatchStop();
    }
  }, [isActive, root, getWatchDirs]);

  // React to plugin active state and expanded dir changes
  useEffect(() => {
    syncWatcher();
  }, [syncWatcher]);

  // React to window focus and document visibility changes
  useEffect(() => {
    const handleFocusChange = () => syncWatcher();
    const handleVisibilityChange = () => syncWatcher();

    window.addEventListener("focus", handleFocusChange);
    window.addEventListener("blur", handleFocusChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocusChange);
      window.removeEventListener("blur", handleFocusChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncWatcher]);

  // Stop watchers on unmount
  useEffect(() => {
    return () => {
      window.terminalAPI.fileWatchStop();
    };
  }, []);

  // Listen for directory change events from the main process
  useEffect(() => {
    const cleanup = window.terminalAPI.onFilesDirChanged(({ dirPath }) => {
      if (!root) return;
      if (dirPath === root) {
        fetchDirEntries(root).then((entries) => setRootEntries(entries)).catch(() => {});
      }
      setExpandedDirs((prev) => {
        if (!prev.has(dirPath)) return prev;
        fetchDirEntries(dirPath).then((entries) => {
          setExpandedDirs((p) => {
            if (!p.has(dirPath)) return p;
            const next = new Map(p);
            next.set(dirPath, entries);
            return next;
          });
        });
        return prev;
      });
    });
    return cleanup;
  }, [root]);

  return {
    expandedDirs,
    root,
    rootEntries,
    loading,
    expandDir,
    collapseDir,
    toggleDir,
    createFile,
    createFolder,
    refreshDir,
    renameEntry,
    deleteEntry,
    moveEntry,
  };
}
