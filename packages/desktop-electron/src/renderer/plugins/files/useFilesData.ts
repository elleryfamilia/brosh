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
}

/** Directories and files to hide from the tree */
const DENY_LIST = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  '__pycache__',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  '.env',
  'dist',
  '.nuxt',
  '.svelte-kit',
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

  return result.entries
    .filter((e) => !DENY_LIST.has(e.name))
    .map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory,
      isFile: e.isFile,
      path: `${dirPath}/${e.name}`,
    }));
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
    setExpandedDirs((prev) => {
      if (!prev.has(dirPath)) return prev;
      // Re-fetch this directory
      fetchDirEntries(dirPath).then((entries) => {
        setExpandedDirs((p) => {
          const next = new Map(p);
          next.set(dirPath, entries);
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
