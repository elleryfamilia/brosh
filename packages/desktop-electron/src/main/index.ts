/**
 * Electron Main Process
 *
 * Entry point for the brosh desktop application.
 * Manages window lifecycle through WindowManager.
 *
 * Architecture:
 * - WindowManager: Manages multiple windows, each with its own TerminalBridge
 * - McpServer: App-scoped singleton, shared across all windows
 * - IPC handlers: Registered once at app level, dispatch to appropriate bridge
 */

// Startup timing — measure before any imports
const _t0 = performance.now();
const _startupTimings: Array<[string, number]> = [];
const _mark = (label: string) => {
  _startupTimings.push([label, performance.now() - _t0]);
};

import os from "os";
import path from "path";
import fs from "fs";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { app, BrowserWindow, ipcMain, session, shell, powerMonitor, systemPreferences } from "electron";
import { WindowManager } from "./window-manager.js";
import { createMenu } from "./menu.js";
import { initSettingsHandlers } from "./settings-store.js";
import {
  initAutoUpdater,
  stopPeriodicCheck,
  startPeriodicCheck,
} from "./auto-updater.js";

import {
  hasSeenWelcome,
  markWelcomeSeen,
  resetWelcomeSeen,
  getAnalyticsEnabled,
  setAnalyticsEnabled,
} from "./analytics-store.js";
import {
  initAnalytics,
  track,
  setConsentAndReinitialize,
  shutdown as shutdownAnalytics,
  submitFeedback,
} from "./analytics.js";
import { detectClaudeCode } from "./ai-cli.js";
import Store from "electron-store";

_mark("imports done");

// Set app name for menu bar (productName in build config only applies when packaged)
app.setName("brosh");

// In dev mode, app.getVersion() returns Electron's version instead of ours.
// Read the real version from package.json.
let appVersion = app.getVersion();
if (!app.isPackaged) {
  try {
    const pkgPath = path.join(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.version) appVersion = pkg.version;
  } catch {
    // Fall back to Electron's version
  }
}

app.setAboutPanelOptions({
  applicationName: "brosh",
  applicationVersion: app.isPackaged ? appVersion : `${appVersion}-dev`,
  copyright: `Copyright © ${new Date().getFullYear()} Ellery Familia`,
  website: "https://github.com/elleryfamilia/brosh",
});

// Global window manager
let windowManager: WindowManager | null = null;

// Git watcher references (moved to module scope for powerMonitor access)
let gitWatcher: import("chokidar").FSWatcher | null = null;
let setupGitWatcher: (() => Promise<void>) | null = null;

// File directory watchers (Files plugin auto-refresh)
// Uses native fs.watch per-directory — event-driven, very low overhead.
// Active only when: renderer requests it AND system is not suspended/locked.
import { watch as fsWatch, type FSWatcher } from "node:fs";
let fileWatchers = new Map<string, FSWatcher>();
let fileWatchDebounce = new Map<string, ReturnType<typeof setTimeout>>();
let fileWatchDesiredDirs: string[] = [];
let fileWatchSuspended = false;

function reconcileFileWatchers(wm: WindowManager) {
  const desired = fileWatchSuspended ? [] : fileWatchDesiredDirs;
  const desiredSet = new Set(desired);
  const currentSet = new Set(fileWatchers.keys());

  // Remove watchers no longer needed
  for (const dir of currentSet) {
    if (!desiredSet.has(dir)) {
      fileWatchers.get(dir)?.close();
      fileWatchers.delete(dir);
      const timer = fileWatchDebounce.get(dir);
      if (timer) { clearTimeout(timer); fileWatchDebounce.delete(dir); }
    }
  }

  // Add watchers for new dirs
  for (const dir of desiredSet) {
    if (currentSet.has(dir)) continue;
    try {
      const watcher = fsWatch(dir, { persistent: false }, () => {
        const existing = fileWatchDebounce.get(dir);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          fileWatchDebounce.delete(dir);
          wm.broadcast("files:dir-changed", { dirPath: dir });
        }, 200);
        timer.unref?.();
        fileWatchDebounce.set(dir, timer);
      });
      watcher.on("error", () => {
        fileWatchers.delete(dir);
      });
      fileWatchers.set(dir, watcher);
    } catch {
      // Directory doesn't exist or can't be watched — skip
    }
  }
}

function stopAllFileWatchers() {
  for (const watcher of fileWatchers.values()) watcher.close();
  fileWatchers.clear();
  for (const timer of fileWatchDebounce.values()) clearTimeout(timer);
  fileWatchDebounce.clear();
}


/**
 * Register all IPC handlers for terminal operations.
 * These are registered once at app startup and dispatch to the appropriate
 * TerminalBridge based on the event sender's window.
 */
function registerIpcHandlers(wm: WindowManager): void {
  // ==========================================
  // Terminal IPC handlers (window-scoped)
  // ==========================================

  ipcMain.handle("terminal:create", async (event, options) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.createSession(options);
  });

  ipcMain.handle("terminal:input", (event, sessionId: string, data: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.input(sessionId, data);
  });

  ipcMain.handle("terminal:resize", (event, sessionId: string, cols: number, rows: number) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.resize(sessionId, cols, rows);
  });

  ipcMain.handle("terminal:getContent", (event, sessionId: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.getContent(sessionId);
  });

  ipcMain.handle("terminal:close", (event, sessionId: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.closeSession(sessionId);
  });

  ipcMain.handle("terminal:isActive", (event, sessionId: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return false;
    return bridge.isActive(sessionId);
  });

  ipcMain.handle("terminal:list", (event) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { sessions: [] };
    return bridge.listSessions();
  });

  ipcMain.handle("terminal:getProcess", (event, sessionId: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.getProcess(sessionId);
  });

  ipcMain.handle("terminal:getCwd", (event, sessionId: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.getCwd(sessionId);
  });

  ipcMain.handle("terminal:getHomedir", () => {
    return os.homedir();
  });

  ipcMain.handle("ai:isClaudeCodeInstalled", (event) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return false;
    return bridge.isClaudeCodeInstalled();
  });

  ipcMain.handle("ai:getClaudeStatus", (event) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { installed: false, authenticated: false };
    return bridge.getClaudeStatus();
  });

  ipcMain.handle("ai:setClaudeModel", (event, model: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false };
    return bridge.setClaudeModel(model as "haiku" | "sonnet" | "opus");
  });


  ipcMain.handle("terminal:checkSandboxAvailability", async (event) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { supported: false, missingDeps: ["Window not found"] };
    return bridge.checkSandboxAvailability();
  });

  ipcMain.handle("terminal:setSandboxMode", async (event, config) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.setSandboxMode(config);
  });

  // ==========================================
  // Shell utilities (window-scoped)
  // ==========================================

  ipcMain.handle("shell:openExternal", async (event, url: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return { success: false, error: "Window not found" };
    return bridge.openExternal(url);
  });

  // ==========================================
  // Git status (for status bar)
  // ==========================================

  ipcMain.handle("git:getStatus", async (_event, cwd?: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const targetCwd = cwd || process.cwd();

    interface GitFileChange {
      path: string;
      status: 'A' | 'M' | 'D' | 'R' | '?' | 'U';
      staged: boolean;
      additions: number;
      deletions: number;
      originalLines: number;
    }

    // Helper to run git commands asynchronously (non-blocking)
    const git = async (args: string[]): Promise<string> => {
      const { stdout } = await execFileAsync("git", args, { cwd: targetCwd, encoding: "utf8" });
      return stdout;
    };

    try {
      // Check if we're in a git repo
      await git(["rev-parse", "--git-dir"]);

      // Get branch name
      let branch: string | null = null;
      try {
        branch = (await git(["symbolic-ref", "--short", "HEAD"])).trim();
      } catch {
        // Detached HEAD state - try to get commit hash
        try {
          branch = (await git(["rev-parse", "--short", "HEAD"])).trim();
        } catch {
          branch = null;
        }
      }

      // Get file-level status with line counts
      const fileMap = new Map<string, GitFileChange>();

      // Parse git status --porcelain for file status
      try {
        const status = await git(["status", "--porcelain"]);
        for (const line of status.split("\n")) {
          if (!line) continue;
          const indexStatus = line[0];
          const workTreeStatus = line[1];
          const path = line.slice(3);

          // Determine overall status
          let fileStatus: GitFileChange['status'];
          let isStaged = false;

          if (indexStatus === "?" && workTreeStatus === "?") {
            fileStatus = '?';
          } else if (indexStatus === "U" || workTreeStatus === "U") {
            fileStatus = 'U';
          } else if (indexStatus === "A" || (indexStatus !== " " && workTreeStatus === "A")) {
            fileStatus = 'A';
            isStaged = indexStatus !== " ";
          } else if (indexStatus === "D" || workTreeStatus === "D") {
            fileStatus = 'D';
            isStaged = indexStatus === "D";
          } else if (indexStatus === "R" || workTreeStatus === "R") {
            fileStatus = 'R';
            isStaged = indexStatus === "R";
          } else {
            fileStatus = 'M';
            isStaged = indexStatus !== " " && indexStatus !== "?";
          }

          fileMap.set(path, {
            path,
            status: fileStatus,
            staged: isStaged,
            additions: 0,
            deletions: 0,
            originalLines: 0,
          });
        }
      } catch {
        // Ignore errors
      }

      // Get line counts for staged changes
      try {
        const stagedDiff = await git(["diff", "--cached", "--numstat"]);
        for (const line of stagedDiff.split("\n")) {
          if (!line) continue;
          const [additions, deletions, path] = line.split("\t");
          const existing = fileMap.get(path);
          if (existing) {
            existing.additions += additions === "-" ? 0 : parseInt(additions, 10) || 0;
            existing.deletions += deletions === "-" ? 0 : parseInt(deletions, 10) || 0;
          }
        }
      } catch {
        // Ignore errors
      }

      // Get line counts for unstaged changes
      try {
        const unstagedDiff = await git(["diff", "--numstat"]);
        for (const line of unstagedDiff.split("\n")) {
          if (!line) continue;
          const [additions, deletions, path] = line.split("\t");
          const existing = fileMap.get(path);
          if (existing) {
            existing.additions += additions === "-" ? 0 : parseInt(additions, 10) || 0;
            existing.deletions += deletions === "-" ? 0 : parseInt(deletions, 10) || 0;
          }
        }
      } catch {
        // Ignore errors
      }

      // Compute original line counts by reading the HEAD version of each file
      await Promise.all(
        Array.from(fileMap.values()).map(async (file) => {
          if (file.status === '?' || file.status === 'A') {
            file.originalLines = 0; // New/untracked files have no original
            return;
          }
          try {
            // ./ makes path relative to CWD, matching porcelain output
            const content = await git(["show", `HEAD:./${file.path}`]);
            file.originalLines = content.split("\n").length;
          } catch {
            file.originalLines = 0;
          }
        })
      );

      // Convert map to array
      const files: GitFileChange[] = Array.from(fileMap.values());

      // Get ahead/behind counts
      let ahead = 0;
      let behind = 0;
      try {
        const revList = (await git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])).trim();
        const [aheadStr, behindStr] = revList.split("\t");
        ahead = parseInt(aheadStr, 10) || 0;
        behind = parseInt(behindStr, 10) || 0;
      } catch {
        // No upstream configured
      }

      return {
        branch,
        dirty: files.length > 0,
        ahead,
        behind,
        files,
      };
    } catch {
      // Not a git repo
      return null;
    }
  });

  // ==========================================
  // Git .git/ watcher (for commits, checkouts, rebases)
  // Working tree changes are detected by renderer-side polling
  // ==========================================

  setupGitWatcher = async () => {
    const chokidar = await import("chokidar");
    const path = await import("path");
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    if (gitWatcher) {
      await gitWatcher.close();
      gitWatcher = null;
    }

    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
      const gitDir = path.join(stdout.trim(), ".git");

      const ignoredGitDirs = new Set(['objects', 'logs']);
      gitWatcher = chokidar.watch(gitDir, {
        ignoreInitial: true,
        awaitWriteFinish: false,
        depth: 3,
        ignored: (filePath: string) => {
          const base = path.basename(filePath);
          if (ignoredGitDirs.has(base)) return true;
          if (base.endsWith('.lock')) return true;
          return false;
        },
      });

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      gitWatcher.on("all", (event, filePath) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log(`[git-watcher] ${event}: ${filePath}`);
          wm.broadcast("git:changed");
        }, 150);
        debounceTimer.unref?.();
      });

      gitWatcher.on("error", (error) => {
        console.error("[git-watcher] Error:", error);
      });

      gitWatcher.on("ready", () => {
        console.log(`[git-watcher] Watching ${gitDir}`);
      });
    } catch {
      console.log("[git-watcher] Not in a git repository or watcher setup failed");
    }
  };

  // Set up git watcher on startup
  setupGitWatcher();

  // Clean up watchers on app quit
  app.on("will-quit", async () => {
    if (gitWatcher) {
      await gitWatcher.close();
      gitWatcher = null;
    }
    stopAllFileWatchers();
  });

  // ==========================================
  // File directory watcher IPC (Files plugin auto-refresh)
  // Renderer sends the list of visible directories; main manages
  // native fs.watch handles and pauses on suspend/lock.
  // ==========================================

  ipcMain.handle("file:watch-dirs", (_event, dirs: string[]) => {
    fileWatchDesiredDirs = dirs;
    reconcileFileWatchers(wm);
  });

  ipcMain.handle("file:watch-stop", () => {
    fileWatchDesiredDirs = [];
    reconcileFileWatchers(wm);
  });

  // ==========================================
  // File IPC handlers (for editor pane)
  // ==========================================

  ipcMain.handle("file:read", async (_event, filePath: string) => {
    const fs = await import("fs/promises");
    const path = await import("path");
    try {
      // Resolve the path (handle ~ for home directory)
      let resolvedPath = filePath;
      if (filePath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), filePath.slice(1));
      }

      const content = await fs.readFile(resolvedPath, "utf-8");
      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read file",
      };
    }
  });

  ipcMain.handle("file:stat", async (_event, filePath: string) => {
    const fs = await import("fs/promises");
    const path = await import("path");
    try {
      // Resolve the path (handle ~ for home directory)
      let resolvedPath = filePath;
      if (filePath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), filePath.slice(1));
      }

      const stat = await fs.stat(resolvedPath);
      return {
        success: true,
        stat: {
          size: stat.size,
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
          mtime: stat.mtime.toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to stat file",
      };
    }
  });

  ipcMain.handle("file:write", async (_event, filePath: string, content: string) => {
    const fs = await import("fs/promises");
    const path = await import("path");

    try {
      let resolvedPath = filePath;
      if (filePath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), filePath.slice(1));
      }

      await fs.writeFile(resolvedPath, content, "utf8");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to write file",
      };
    }
  });

  ipcMain.handle("file:readdir", async (_event, dirPath: string) => {
    const fs = await import("fs/promises");
    const path = await import("path");
    try {
      let resolvedPath = dirPath;
      if (dirPath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), dirPath.slice(1));
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const sorted = entries
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
        .sort((a, b) => {
          // Directories first, then case-insensitive alphabetical
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
      return { success: true, entries: sorted };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read directory",
      };
    }
  });

  ipcMain.handle("file:mkdir", async (_event, dirPath: string) => {
    const fs = await import("fs/promises");
    const path = await import("path");
    try {
      let resolvedPath = dirPath;
      if (dirPath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), dirPath.slice(1));
      }

      await fs.mkdir(resolvedPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create directory",
      };
    }
  });

  ipcMain.handle("file:rename", async (_event, oldPath: string, newPath: string) => {
    const fs = await import("fs/promises");
    const path = await import("path");
    try {
      let resolvedOld = oldPath;
      let resolvedNew = newPath;
      if (oldPath.startsWith("~")) {
        const os = await import("os");
        resolvedOld = path.join(os.homedir(), oldPath.slice(1));
      }
      if (newPath.startsWith("~")) {
        const os = await import("os");
        resolvedNew = path.join(os.homedir(), newPath.slice(1));
      }
      await fs.rename(resolvedOld, resolvedNew);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to rename",
      };
    }
  });

  ipcMain.handle("file:trash", async (_event, filePath: string) => {
    const path = await import("path");
    try {
      let resolvedPath = filePath;
      if (filePath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), filePath.slice(1));
      }
      await shell.trashItem(resolvedPath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to move to trash",
      };
    }
  });

  ipcMain.handle("file:showInFolder", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  ipcMain.handle("git:listMarkdownFiles", async (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    try {
      const rootResult = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        cwd: cwd || undefined,
      });
      const root = rootResult.stdout.trim();

      const { stdout } = await execFileAsync("git", ["ls-files", "*.md", "**/*.md"], {
        encoding: "utf8",
        cwd: root,
      });
      const files = stdout.trim().split("\n").filter(Boolean);
      return { success: true, files, root };
    } catch {
      return { success: false, files: [], root: null };
    }
  });

  ipcMain.handle("git:showFile", async (_event, filePath: string, ref: string = "HEAD") => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const path = await import("path");
    const execFileAsync = promisify(execFile);

    try {
      // Resolve the path
      let resolvedPath = filePath;
      if (filePath.startsWith("~")) {
        const os = await import("os");
        resolvedPath = path.join(os.homedir(), filePath.slice(1));
      }

      // Get the git root to construct relative path
      const dir = path.dirname(resolvedPath);
      const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: dir,
        encoding: "utf8",
      });
      const relativePath = path.relative(gitRoot.trim(), resolvedPath);

      // Get file content at specified ref
      const { stdout: content } = await execFileAsync("git", ["show", `${ref}:${relativePath}`], {
        cwd: gitRoot.trim(),
        encoding: "utf8",
      });

      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get file from git",
      };
    }
  });

  // ==========================================
  // Context memory file discovery
  // ==========================================

  ipcMain.handle("context:discoverMemoryFiles", async (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const fsp = await import("fs/promises");
    const homedir = os.homedir();
    const targetCwd = cwd || process.cwd();

    interface MemoryFileInfo {
      absolutePath: string;
      name: string;
      sourceKind: 'project' | 'project-local' | 'user' | 'rule' | 'auto';
      isMemory: boolean;
      isExternal: boolean;
      writable: boolean;
      locationHint: string;
    }

    // Find git root by walking up from cwd
    let gitRoot: string | null = null;
    try {
      const { execFile: execFileCb } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFileCb);
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        cwd: targetCwd,
      });
      gitRoot = stdout.trim();
    } catch {
      // Not in a git repo
    }

    const files: MemoryFileInfo[] = [];
    const seen = new Set<string>();

    async function tryAdd(
      absPath: string,
      sourceKind: MemoryFileInfo['sourceKind'],
      isMemory: boolean
    ): Promise<void> {
      if (seen.has(absPath)) return;
      seen.add(absPath);
      try {
        const stat = await fsp.stat(absPath);
        if (!stat.isFile()) return;
        let writable = false;
        try {
          await fsp.access(absPath, fs.constants.W_OK);
          writable = true;
        } catch { /* not writable */ }

        const isExternal = gitRoot ? !absPath.startsWith(gitRoot + '/') && absPath !== gitRoot : true;

        // Compute human-readable location hint
        let locationHint: string;
        if (!isExternal && gitRoot) {
          // Inside project — show relative path from git root
          const rel = path.relative(gitRoot, path.dirname(absPath));
          locationHint = rel ? `./${rel}/` : './';
        } else if (absPath.startsWith(homedir)) {
          // Outside project — show ~/... path
          const rel = path.relative(homedir, path.dirname(absPath));
          locationHint = `~/${rel}/`;
        } else {
          locationHint = path.dirname(absPath) + '/';
        }

        files.push({
          absolutePath: absPath,
          name: path.basename(absPath),
          sourceKind,
          isMemory,
          isExternal,
          writable,
          locationHint,
        });
      } catch {
        // File doesn't exist, skip
      }
    }

    async function tryAddDir(
      dirPath: string,
      sourceKind: MemoryFileInfo['sourceKind'],
      isMemory: boolean
    ): Promise<void> {
      try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            await tryAdd(path.join(dirPath, entry.name), sourceKind, isMemory);
          } else if (entry.isDirectory()) {
            // Recurse one level for rules dirs
            const subEntries = await fsp.readdir(path.join(dirPath, entry.name), { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isFile() && sub.name.endsWith('.md')) {
                await tryAdd(path.join(dirPath, entry.name, sub.name), sourceKind, isMemory);
              }
            }
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    // Project-level files (in git root)
    if (gitRoot) {
      await tryAdd(path.join(gitRoot, "CLAUDE.md"), 'project', false);
      await tryAdd(path.join(gitRoot, "CLAUDE.local.md"), 'project-local', false);
      await tryAdd(path.join(gitRoot, ".claude", "CLAUDE.md"), 'project', false);
      await tryAddDir(path.join(gitRoot, ".claude", "rules"), 'rule', false);
    }

    // User-level files
    await tryAdd(path.join(homedir, ".claude", "CLAUDE.md"), 'user', false);
    await tryAddDir(path.join(homedir, ".claude", "rules"), 'rule', false);

    // Auto-memory: ~/.claude/projects/<encoded-path>/memory/*.md
    // Claude Code encodes project paths by replacing / and _ with -
    // e.g. /Users/ellery/_git/qubo → -Users-ellery--git-qubo
    // Only show memory for the current project (git root or cwd).
    const encodePath = (p: string) => p.replace(/[/_]/g, '-');
    const candidatePaths = [targetCwd];
    if (gitRoot && gitRoot !== targetCwd) candidatePaths.push(gitRoot);
    const encodedCandidates = new Set(candidatePaths.map(encodePath));

    try {
      const projectsDir = path.join(homedir, ".claude", "projects");
      const projectDirs = await fsp.readdir(projectsDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        if (!encodedCandidates.has(dir.name)) continue;
        const memoryDir = path.join(projectsDir, dir.name, "memory");
        try {
          const memEntries = await fsp.readdir(memoryDir, { withFileTypes: true });
          for (const entry of memEntries) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
              await tryAdd(path.join(memoryDir, entry.name), 'auto', true);
            }
          }
        } catch {
          // No memory dir for this project
        }
      }
    } catch {
      // ~/.claude/projects doesn't exist
    }

    return { success: true, files };
  });

  ipcMain.handle("git:getRoot", async (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        cwd: cwd || undefined,
      });
      return { success: true, root: stdout.trim() };
    } catch {
      return { success: false, root: null };
    }
  });

  ipcMain.handle("git:listWorktrees", async (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    try {
      const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
        encoding: "utf8",
        cwd: cwd || undefined,
      });

      interface Worktree {
        path: string;
        branch: string | null;
        head: string;
        isBare: boolean;
      }

      const worktrees: Worktree[] = [];
      let current: Partial<Worktree> = {};

      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current.path) worktrees.push(current as Worktree);
          current = { path: line.slice(9), branch: null, head: "", isBare: false };
        } else if (line.startsWith("HEAD ")) {
          current.head = line.slice(5);
        } else if (line.startsWith("branch ")) {
          // branch refs/heads/main → main
          const ref = line.slice(7);
          current.branch = ref.replace(/^refs\/heads\//, "");
        } else if (line === "bare") {
          current.isBare = true;
        } else if (line === "" && current.path) {
          worktrees.push(current as Worktree);
          current = {};
        }
      }
      if (current.path) worktrees.push(current as Worktree);

      return { success: true, worktrees };
    } catch {
      return { success: false, worktrees: [] };
    }
  });

  ipcMain.handle("git:getCommonDir", async (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const path = await import("path");
    const execFileAsync = promisify(execFile);

    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
        encoding: "utf8",
        cwd: cwd || undefined,
        timeout: 2000,
      });
      const resolved = path.resolve(cwd || ".", stdout.trim());
      return { success: true, commonDir: resolved };
    } catch {
      return { success: false, commonDir: null };
    }
  });

  ipcMain.handle("git:removeWorktree", async (_event: Electron.IpcMainInvokeEvent, worktreePath: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    try {
      await execFileAsync("git", ["worktree", "remove", worktreePath], {
        encoding: "utf8",
        timeout: 10000,
      });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the error to the renderer so it can prompt the user
      // instead of silently force-removing uncommitted work.
      return { success: false, error: msg };
    }
  });

  ipcMain.handle("git:checkIgnore", async (_event: Electron.IpcMainInvokeEvent, paths: string[]) => {
    if (paths.length === 0) return { success: true, ignored: [] };

    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Derive cwd from the parent directory of the first path
    const cwd = paths[0].substring(0, paths[0].lastIndexOf("/"));

    try {
      const { stdout } = await execFileAsync("git", ["check-ignore", ...paths], {
        encoding: "utf8",
        cwd,
      });
      const ignored = stdout.trim().split("\n").filter(Boolean);
      return { success: true, ignored };
    } catch {
      // Exit code 1 means none are ignored; 128 means not a git repo — both fine
      return { success: true, ignored: [] };
    }
  });

  // Claude agent sessions discovery.
  // Two-pronged approach:
  //  A) Read ~/.claude/sessions/*.json for launcher PIDs (covers all projects)
  //  B) For a given project, scan JSONL files modified in the last hour for
  //     subagents + tasks (catches sessions whose JSONL ID differs from sessions/ entry)
  ipcMain.handle("claude:getActiveSessions", async (_event: Electron.IpcMainInvokeEvent, projectCwd?: string) => {
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const claudeDir = path.join(os.homedir(), ".claude");
    const sessionsDir = path.join(claudeDir, "sessions");
    const projectsDir = path.join(claudeDir, "projects");

    interface SubagentInfo {
      id: string;
      agentType: string;
    }

    interface TaskInfo {
      id: number;
      subject: string;
      status: string;
    }

    interface ActiveSession {
      pid: number;
      sessionId: string;
      cwd: string;
      startedAt: number;
      alive: boolean;
      projectName: string;
      gitBranch: string | null;
      gitCommonDir: string | null;
      summary: string | null;
      messageCount: number;
      lastActivity: number | null;
      subagents: SubagentInfo[];
      tasks: TaskInfo[];
    }

    // Helper: read subagents from a session dir
    async function readSubagents(projectDir: string, sessionId: string): Promise<SubagentInfo[]> {
      const subagents: SubagentInfo[] = [];
      try {
        const dir = path.join(projectDir, sessionId, "subagents");
        const files = (await fs.promises.readdir(dir)).filter((f: string) => f.endsWith(".meta.json"));
        for (const f of files) {
          try {
            const raw = await fs.promises.readFile(path.join(dir, f), "utf8");
            const meta = JSON.parse(raw);
            subagents.push({
              id: f.replace(".meta.json", "").replace("agent-", ""),
              agentType: meta.agentType || "unknown",
            });
          } catch { /* skip */ }
        }
      } catch { /* no subagents dir */ }
      return subagents;
    }

    // Helper: extract tasks from JSONL tail
    async function readTasks(jsonlPath: string): Promise<TaskInfo[]> {
      const tasks: TaskInfo[] = [];
      try {
        const stat = await fs.promises.stat(jsonlPath);
        const readSize = Math.min(stat.size, 100_000);
        const fd = await fs.promises.open(jsonlPath, "r");
        const buf = Buffer.alloc(readSize);
        await fd.read(buf, 0, readSize, Math.max(0, stat.size - readSize));
        await fd.close();
        const tail = buf.toString("utf8");

        const taskMap = new Map<number, TaskInfo>();
        for (const line of tail.split("\n")) {
          if (!line.includes("TaskCreate") && !line.includes("TaskUpdate")) continue;
          try {
            const entry = JSON.parse(line);
            const contents = entry?.message?.content;
            if (!Array.isArray(contents)) continue;
            for (const block of contents) {
              if (block.type !== "tool_use") continue;
              if (block.name === "TaskCreate" && block.input) {
                const id = taskMap.size + 1;
                taskMap.set(id, {
                  id,
                  subject: block.input.subject || block.input.description || "Task",
                  status: "pending",
                });
              } else if (block.name === "TaskUpdate" && block.input) {
                const tid = block.input.id ?? block.input.task_id;
                if (tid != null && taskMap.has(tid)) {
                  const existing = taskMap.get(tid)!;
                  if (block.input.status) existing.status = block.input.status;
                  if (block.input.subject) existing.subject = block.input.subject;
                }
              }
            }
          } catch { /* skip bad JSON lines */ }
        }
        for (const [, task] of taskMap) {
          if (task.status !== "completed") tasks.push(task);
        }
      } catch { /* no JSONL */ }
      return tasks;
    }

    try {
      const sessions: ActiveSession[] = [];
      const seenSessionIds = new Set<string>();

      // --- Prong A: Read sessions/*.json for launcher PIDs ---
      try {
        const sessionFiles = (await fs.promises.readdir(sessionsDir)).filter((f: string) => f.endsWith(".json"));
        for (const file of sessionFiles) {
          try {
            const raw = await fs.promises.readFile(path.join(sessionsDir, file), "utf8");
            const data = JSON.parse(raw);
            if (!data.pid || !data.sessionId) continue;

            let alive = false;
            try { process.kill(data.pid, 0); alive = true; } catch { /* dead */ }

            const cwd = data.cwd || "";
            const projectName = cwd.split("/").pop() || cwd;
            const projectKey = cwd.replace(/[/_]/g, "-");
            const projectDir = path.join(projectsDir, projectKey);

            let gitBranch: string | null = null;
            let gitCommonDir: string | null = null;

            try {
              const { stdout } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
                encoding: "utf8", cwd, timeout: 2000,
              });
              gitCommonDir = path.resolve(cwd, stdout.trim());
            } catch { /* not git */ }

            try {
              const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
                encoding: "utf8", cwd, timeout: 2000,
              });
              gitBranch = stdout.trim() || null;
            } catch { /* not git */ }

            const subagents = await readSubagents(projectDir, data.sessionId);
            const jsonlPath = path.join(projectDir, `${data.sessionId}.jsonl`);
            let lastActivity: number | null = data.startedAt || null;
            try {
              const stat = await fs.promises.stat(jsonlPath);
              lastActivity = stat.mtimeMs;
            } catch { /* no JSONL */ }

            const tasks = alive ? await readTasks(jsonlPath) : [];

            seenSessionIds.add(data.sessionId);
            sessions.push({
              pid: data.pid,
              sessionId: data.sessionId,
              cwd,
              startedAt: data.startedAt || 0,
              alive,
              projectName,
              gitBranch,
              gitCommonDir,
              summary: null,
              messageCount: 0,
              lastActivity,
              subagents,
              tasks,
            });
          } catch { /* skip corrupt */ }
        }
      } catch { /* no sessions dir */ }

      // --- Prong B: Scan project dir for recently active JSONL sessions ---
      // This catches sessions launched from brosh where the JSONL session ID
      // differs from the sessions/ entry (e.g., Claude Code spawns a worker
      // with its own session ID).
      if (projectCwd) {
        const projectKey = projectCwd.replace(/[/_]/g, "-");
        const projectDir = path.join(projectsDir, projectKey);
        const ONE_HOUR = 60 * 60 * 1000;
        const now = Date.now();

        try {
          const entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
            const sessionId = entry.name.replace(".jsonl", "");
            if (seenSessionIds.has(sessionId)) continue;

            const jsonlPath = path.join(projectDir, entry.name);
            const stat = await fs.promises.stat(jsonlPath);
            if (now - stat.mtimeMs > ONE_HOUR) continue; // Skip stale

            const subagents = await readSubagents(projectDir, sessionId);
            const tasks = await readTasks(jsonlPath);

            // Only include if it has subagents or tasks (otherwise it's just a session entry)
            if (subagents.length === 0 && tasks.length === 0) continue;

            let gitBranch: string | null = null;
            let gitCommonDir: string | null = null;
            try {
              const { stdout } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
                encoding: "utf8", cwd: projectCwd, timeout: 2000,
              });
              gitCommonDir = path.resolve(projectCwd, stdout.trim());
            } catch { /* not git */ }
            try {
              const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
                encoding: "utf8", cwd: projectCwd, timeout: 2000,
              });
              gitBranch = stdout.trim() || null;
            } catch { /* not git */ }

            seenSessionIds.add(sessionId);
            sessions.push({
              pid: 0,
              sessionId,
              cwd: projectCwd,
              startedAt: 0,
              alive: false, // No PID available — can't verify liveness
              projectName: projectCwd.split("/").pop() || projectCwd,
              gitBranch,
              gitCommonDir,
              summary: null,
              messageCount: 0,
              lastActivity: stat.mtimeMs,
              subagents,
              tasks,
            });
          }
        } catch { /* no project dir */ }
      }

      // Deduplicate: when multiple sessions share a CWD, keep the one with
      // more subagents/tasks (Prong B finds richer data than Prong A)
      const byCwd = new Map<string, ActiveSession>();
      for (const s of sessions) {
        const existing = byCwd.get(s.cwd);
        if (!existing) {
          byCwd.set(s.cwd, s);
        } else {
          const existingRichness = existing.subagents.length + existing.tasks.length;
          const newRichness = s.subagents.length + s.tasks.length;
          if (newRichness > existingRichness) {
            // Keep the richer one but preserve alive/pid from the launcher if available
            if (existing.pid > 0 && existing.alive) {
              s.pid = existing.pid;
              s.alive = true;
            }
            byCwd.set(s.cwd, s);
          }
        }
      }
      const deduped = Array.from(byCwd.values());

      deduped.sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      });

      return { success: true, sessions: deduped };
    } catch {
      return { success: false, sessions: [] };
    }
  });

  // Read/write ~/.claude/settings.json for agent teams toggle
  ipcMain.handle("claude:setAgentTeams", async (_event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");

    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");

    try {
      let data: Record<string, unknown> = {};
      try {
        const raw = await fs.promises.readFile(settingsPath, "utf8");
        data = JSON.parse(raw);
      } catch {
        // File doesn't exist or is invalid — start fresh
      }

      if (enabled) {
        const env = (data.env as Record<string, string>) || {};
        env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1";
        data.env = env;
      } else {
        const env = (data.env as Record<string, string>) || {};
        delete env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"];
        // Remove the env key entirely if empty
        if (Object.keys(env).length === 0) {
          delete data.env;
        } else {
          data.env = env;
        }
      }

      await fs.promises.writeFile(settingsPath, JSON.stringify(data, null, 2) + "\n", "utf8");
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("claude:getAgentTeams", async () => {
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");

    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");

    try {
      const raw = await fs.promises.readFile(settingsPath, "utf8");
      const data = JSON.parse(raw);
      const env = data.env as Record<string, string> | undefined;
      return { success: true, enabled: env?.["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1" };
    } catch {
      return { success: true, enabled: false };
    }
  });

  ipcMain.handle("git:getCommits", async (_event: Electron.IpcMainInvokeEvent, cwd?: string, count?: number) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const limit = count || 50;

    try {
      const [statusResult, numstatResult] = await Promise.all([
        execFileAsync("git", [
          "log", `-${limit}`, "--topo-order",
          "--format=__COMMIT__%h%x00%an%x00%aI%x00%s%x00%p%x00%D",
          "--name-status",
        ], { encoding: "utf8", cwd: cwd || undefined, maxBuffer: 1024 * 1024 }),
        execFileAsync("git", [
          "log", `-${limit}`, "--topo-order",
          "--format=__COMMIT__%h",
          "--numstat",
        ], { encoding: "utf8", cwd: cwd || undefined, maxBuffer: 1024 * 1024 }),
      ]);

      // Parse numstat data: hash -> { path -> { additions, deletions } }
      const numstatMap = new Map<string, Map<string, { additions: number; deletions: number }>>();
      const numstatBlocks = numstatResult.stdout.split("__COMMIT__").filter(Boolean);
      for (const block of numstatBlocks) {
        const lines = block.split("\n").filter(Boolean);
        if (lines.length === 0) continue;
        const hash = lines[0].trim();
        const fileMap = new Map<string, { additions: number; deletions: number }>();
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split("\t");
          if (parts.length >= 3) {
            const adds = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
            const dels = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
            const filePath = parts.slice(2).join("\t"); // handle paths with tabs
            fileMap.set(filePath, { additions: adds, deletions: dels });
          }
        }
        numstatMap.set(hash, fileMap);
      }

      // Parse status data
      const commits: Array<{
        hash: string;
        message: string;
        author: string;
        date: string;
        parents: string[];
        refs: string[];
        files: Array<{
          path: string;
          status: string;
          additions: number;
          deletions: number;
          oldPath?: string;
        }>;
      }> = [];

      const statusBlocks = statusResult.stdout.split("__COMMIT__").filter(Boolean);
      for (const block of statusBlocks) {
        const lines = block.split("\n");
        if (lines.length === 0) continue;
        const headerParts = lines[0].split("\0");
        if (headerParts.length < 4) continue;

        const hash = headerParts[0].trim();
        const author = headerParts[1];
        const date = headerParts[2];
        const message = headerParts[3];
        const parents = headerParts[4]?.trim().split(" ").filter(Boolean) ?? [];
        const refs = headerParts[5]?.trim().split(", ").filter(Boolean) ?? [];

        const fileStats = numstatMap.get(hash);
        const files: Array<{
          path: string;
          status: string;
          additions: number;
          deletions: number;
          oldPath?: string;
        }> = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const tabIdx = line.indexOf("\t");
          if (tabIdx === -1) continue;
          const statusChar = line.substring(0, tabIdx).trim();
          const pathPart = line.substring(tabIdx + 1);

          let filePath = pathPart;
          let oldPath: string | undefined;
          let normalizedStatus = statusChar.charAt(0);

          // Handle renames: R100\told\tnew
          if (normalizedStatus === "R") {
            const renameParts = pathPart.split("\t");
            if (renameParts.length >= 2) {
              oldPath = renameParts[0];
              filePath = renameParts[1];
            }
          }

          // Normalize to allowed statuses
          if (!["A", "M", "D", "R"].includes(normalizedStatus)) {
            normalizedStatus = "M";
          }

          const stats = fileStats?.get(filePath) || { additions: 0, deletions: 0 };

          files.push({
            path: filePath,
            status: normalizedStatus,
            additions: stats.additions,
            deletions: stats.deletions,
            oldPath,
          });
        }

        commits.push({ hash, message, author, date, parents, refs, files });
      }

      return commits;
    } catch (error) {
      console.error("git:getCommits failed:", error);
      return null;
    }
  });

  // ==========================================
  // MCP IPC handlers (app-scoped)
  // ==========================================

  ipcMain.handle("mcp:getStatus", () => {
    const mcpServer = wm.getMcpServer();
    return mcpServer?.getStatus() ?? { isRunning: false, clientCount: 0, socketPath: "" };
  });

  ipcMain.handle("mcp:start", async () => {
    const mcpServer = wm.getMcpServer();
    await mcpServer?.start();
    return mcpServer?.getStatus() ?? { isRunning: false, clientCount: 0, socketPath: "" };
  });

  ipcMain.handle("mcp:stop", () => {
    const mcpServer = wm.getMcpServer();
    mcpServer?.stop();
    return mcpServer?.getStatus() ?? { isRunning: false, clientCount: 0, socketPath: "" };
  });

  ipcMain.handle("mcp:attach", async (_event, sessionId: string) => {
    const mcpServer = wm.getMcpServer();
    if (!mcpServer) return false;

    // Auto-start the server if not running (first time enabling MCP)
    const status = mcpServer.getStatus();
    if (!status.isRunning) {
      await mcpServer.start();
    }

    return mcpServer.attach(sessionId);
  });

  ipcMain.handle("mcp:detach", () => {
    const mcpServer = wm.getMcpServer();
    mcpServer?.detach();
    return true;
  });

  ipcMain.handle("mcp:getAttached", () => {
    const mcpServer = wm.getMcpServer();
    return mcpServer?.getAttachedSessionId() ?? null;
  });

  ipcMain.handle("mcp:getClients", () => {
    const mcpServer = wm.getMcpServer();
    return mcpServer?.getConnectedClients() ?? [];
  });

  ipcMain.handle("mcp:disconnectClient", (_event, clientId: string) => {
    const mcpServer = wm.getMcpServer();
    return mcpServer?.disconnectClient(clientId) ?? false;
  });


  // ==========================================
  // Window IPC handlers
  // ==========================================

  ipcMain.handle("window:create", async () => {
    await wm.createWindow();
    return { success: true };
  });

  // ==========================================
  // Analytics IPC handlers
  // ==========================================

  ipcMain.handle("analytics:getConsent", () => {
    return getAnalyticsEnabled();
  });

  ipcMain.handle("analytics:setConsent", (_event, enabled: boolean) => {
    setConsentAndReinitialize(enabled);
    return { success: true };
  });

  ipcMain.handle("analytics:hasSeenWelcome", () => {
    return hasSeenWelcome();
  });

  ipcMain.handle("analytics:markWelcomeSeen", () => {
    markWelcomeSeen();
    return { success: true };
  });

  ipcMain.handle("analytics:track", (_event, eventName: string, properties?: Record<string, unknown>) => {
    track(eventName, properties);
    return { success: true };
  });

  ipcMain.handle("analytics:submitFeedback", async (_event, category: string, message: string, email?: string) => {
    return submitFeedback(category, message, email);
  });

  // ==========================================
  // IDE Protocol IPC handlers
  // ==========================================

  ipcMain.handle("ide:getStatus", () => {
    const ideServer = wm.getIdeProtocolServer();
    if (!ideServer) return { isRunning: false, port: 0, hasClient: false };
    return ideServer.getStatus();
  });

  // Legacy: kept for backward compat but no longer auto-reports to IDE protocol
  ipcMain.handle("ide:reportSelection", () => {
    // No-op: replaced by explicit ide:addFragment
  });

  ipcMain.handle("ide:addFragment", (_event, sessionId: string, text: string) => {
    const ideServer = wm.getIdeProtocolServer();
    ideServer?.addContextFragment(sessionId, text);
  });

  ipcMain.handle("ide:removeFragment", (_event, index: number) => {
    const ideServer = wm.getIdeProtocolServer();
    ideServer?.removeContextFragment(index);
  });

  ipcMain.handle("ide:clearFragments", () => {
    const ideServer = wm.getIdeProtocolServer();
    ideServer?.clearContextFragments();
  });

  ipcMain.handle("ide:reportFileOpen", (_event, filePath: string) => {
    const ideServer = wm.getIdeProtocolServer();
    ideServer?.sendFileOpen(filePath);
  });

  ipcMain.on("ide:selectionResponse", (_event, requestId: string, sessionId: string, text: string) => {
    const ideServer = wm.getIdeProtocolServer();
    ideServer?.handleSelectionResponse(requestId, sessionId, text);
  });

  ipcMain.handle("ide:restart", async (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const ideServer = wm.getIdeProtocolServer();
    if (!ideServer) return { success: false, error: "IDE protocol server not available" };
    await ideServer.restart([cwd || process.cwd()]);
    return { success: true };
  });

  ipcMain.handle("ide:updateWorkspaceFolders", (_event: Electron.IpcMainInvokeEvent, cwd?: string) => {
    const ideServer = wm.getIdeProtocolServer();
    if (!ideServer) return { success: false, error: "IDE protocol server not available" };
    ideServer.updateWorkspaceFolders([cwd || process.cwd()]);
    return { success: true };
  });

  // ==========================================
  // Claude Code info IPC handlers
  // ==========================================

  const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");

  /** Read model + version from Claude Code's settings and CLI */
  function readClaudeInfo(): { model: string | null; version: string | null } {
    let model: string | null = null;
    let version: string | null = null;

    // Read model from settings.json
    try {
      const raw = fs.readFileSync(claudeSettingsPath, "utf-8");
      const settings = JSON.parse(raw);
      if (typeof settings.model === "string") {
        model = settings.model;
      }
    } catch {
      // File doesn't exist or parse error
    }

    // Get version from CLI
    try {
      const out = execFileSync("claude", ["--version"], { encoding: "utf-8", timeout: 3000 }).trim();
      if (out) version = out;
    } catch {
      // CLI not installed or not in PATH
    }

    return { model, version };
  }

  ipcMain.handle("claude:getInfo", () => {
    return readClaudeInfo();
  });

  // Watch ~/.claude/ directory for settings.json changes.
  // We watch the directory (not the file) because Claude Code does atomic writes
  // (write temp → rename), which replaces the inode and kills file-level watchers.
  let claudeSettingsWatcher: fs.FSWatcher | null = null;
  let claudeSettingsDebounce: ReturnType<typeof setTimeout> | null = null;
  try {
    const claudeDir = path.dirname(claudeSettingsPath);
    if (fs.existsSync(claudeDir)) {
      claudeSettingsWatcher = fs.watch(claudeDir, { persistent: false }, (_event, filename) => {
        if (filename !== "settings.json") return;
        if (claudeSettingsDebounce) clearTimeout(claudeSettingsDebounce);
        claudeSettingsDebounce = setTimeout(() => {
          const info = readClaudeInfo();
          wm.broadcast("claude:infoChanged", info);
        }, 100);
      });
      claudeSettingsWatcher.on("error", () => {
        // Directory may not exist yet, ignore
      });
    }
  } catch {
    // Ignore watch setup errors
  }

  app.on("will-quit", () => {
    claudeSettingsWatcher?.close();
    claudeSettingsWatcher = null;
  });

  // ==========================================
  // Plans watcher + IPC handlers
  // ==========================================

  interface PlanIndexEntry {
    absolutePath: string;
    name: string;
    title: string | null;
    mtime: number;
  }

  // In-memory index of all plan files (keyed by filename)
  const planIndex = new Map<string, PlanIndexEntry>();

  // Determine plans directory from Claude settings, defaulting to ~/.claude/plans/
  let plansDirectory = path.join(os.homedir(), ".claude", "plans");
  try {
    const raw = fs.readFileSync(claudeSettingsPath, "utf-8");
    const settings = JSON.parse(raw);
    if (typeof settings.plansDirectory === "string") {
      plansDirectory = settings.plansDirectory;
    }
  } catch {
    // Use default
  }

  /** Extract the first H1 heading from markdown content */
  function extractPlanTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /** Scan a single plan file and update the index */
  function indexPlanFile(filePath: string): PlanIndexEntry | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;
      const name = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const entry: PlanIndexEntry = {
        absolutePath: filePath,
        name,
        title: extractPlanTitle(content),
        mtime: stat.mtimeMs,
      };
      planIndex.set(name, entry);
      return entry;
    } catch {
      return null;
    }
  }

  /** Initial scan of plans directory */
  function scanPlansDirectory(): void {
    try {
      if (!fs.existsSync(plansDirectory)) return;
      const files = fs.readdirSync(plansDirectory);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        indexPlanFile(path.join(plansDirectory, file));
      }
    } catch {
      // Directory may not exist
    }
  }

  // Persistent store for classified + dismissed plans per project
  interface PlanCacheSchema {
    // Per-plan, per-project classification decisions (true = related).
    // Missing entries = not yet classified (show by default).
    // Use plan:resetIndex to clear and re-classify.
    planClassified: Record<string, Record<string, boolean>>;
    planDismissed: Record<string, string[]>; // gitRoot -> dismissed filenames
    planIndexed: Record<string, boolean>; // gitRoot -> true if indexed at least once
    migrationVersion: number; // Track migrations to run only once
  }
  const planStore = new Store<PlanCacheSchema>({
    name: "plan-index-cache",
    defaults: { planClassified: {}, planDismissed: {}, planIndexed: {}, migrationVersion: 0 },
  });

  // Run migrations only once based on version
  {
    const version = planStore.get("migrationVersion") ?? 0;
    if (version < 1) {
      // Migration v1: Clear the entire cache and start fresh.
      // Old format had issues - easiest to just reset.
      planStore.set("planClassified", {});
      planStore.set("planDismissed", {});
      planStore.set("planIndexed", {});
      planStore.set("migrationVersion", 1);
      console.log("[plans] migration v1: reset cache to fresh format");
    }
  }

  /** Remove a filename from planClassified and planDismissed across all projects */
  function pruneDeletedPlan(filename: string): void {
    const classified = planStore.get("planClassified");
    let changed = false;
    for (const gitRoot of Object.keys(classified)) {
      if (filename in classified[gitRoot]) {
        delete classified[gitRoot][filename];
        changed = true;
      }
    }
    if (changed) planStore.set("planClassified", classified);

    const dismissed = planStore.get("planDismissed");
    for (const gitRoot of Object.keys(dismissed)) {
      const idx = dismissed[gitRoot]?.indexOf(filename);
      if (idx !== undefined && idx >= 0) {
        dismissed[gitRoot].splice(idx, 1);
        planStore.set("planDismissed", dismissed);
      }
    }
  }

  /** Get plans for a project — only classified-as-related plans (or all if not yet classified), minus dismissed ones.
   *  Prunes stale entries (files that no longer exist in planIndex). */
  function getPlansForProject(gitRoot: string): Array<{
    absolutePath: string;
    name: string;
    title: string | null;
    mtime: string;
  }> {
    const allClassified = planStore.get("planClassified");
    const decisions = allClassified[gitRoot];
    console.log(`[plans] getPlansForProject(${gitRoot}): decisions =`, decisions, ', planIndex size =', planIndex.size);

    const dismissed = new Set(planStore.get("planDismissed")[gitRoot] ?? []);

    // Prune stale entries (files deleted/renamed since last classification)
    // If decisions becomes empty after pruning, delete the whole entry
    if (decisions) {
      let pruned = false;
      for (const filename of Object.keys(decisions)) {
        if (!planIndex.has(filename)) {
          delete decisions[filename];
          pruned = true;
        }
      }
      if (pruned) {
        if (Object.keys(decisions).length === 0) {
          delete allClassified[gitRoot];
        } else {
          allClassified[gitRoot] = decisions;
        }
        planStore.set("planClassified", allClassified);
      }
    }

    const results: Array<{ absolutePath: string; name: string; title: string | null; mtime: string }> = [];
    const planIndexed = planStore.get("planIndexed");

    // Only show plans that have been classified as related to this project.
    // Unindexed projects show nothing — user can click "Index Plans" to classify.
    if (!planIndexed[gitRoot]) {
      // Not yet indexed — return empty so the panel shows the "Index Plans" prompt
      return results;
    }

    if (decisions && Object.keys(decisions).length > 0) {
      // User has indexed - only show related (true) plans
      for (const [filename, isRelated] of Object.entries(decisions)) {
        if (!isRelated || dismissed.has(filename)) continue;
        const entry = planIndex.get(filename);
        if (entry) {
          results.push({
            absolutePath: entry.absolutePath,
            name: entry.name,
            title: entry.title,
            mtime: new Date(entry.mtime).toISOString(),
          });
        }
      }
    }

    // Sort by mtime descending
    return results.sort(
      (a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
    );
  }

  // Initial scan (populates the in-memory index so cached results can resolve)
  scanPlansDirectory();

  // IPC: get plans for project (cached index, minus dismissed)
  ipcMain.handle("plan:getForProject", (_event, gitRoot: string) => {
    return getPlansForProject(gitRoot);
  });

  // IPC: dismiss a plan for a project
  ipcMain.handle("plan:dismiss", (_event, gitRoot: string, filename: string) => {
    const dismissed = planStore.get("planDismissed");
    const list = dismissed[gitRoot] ?? [];
    if (!list.includes(filename)) {
      list.push(filename);
      dismissed[gitRoot] = list;
      planStore.set("planDismissed", dismissed);
    }
    return getPlansForProject(gitRoot);
  });

  // IPC: reset plan index for a project (clears all classification decisions)
  ipcMain.handle("plan:resetIndex", (_event, gitRoot: string) => {
    const classified = planStore.get("planClassified");
    delete classified[gitRoot];
    planStore.set("planClassified", classified);
    // Also clear dismissed list so a fresh re-index starts clean
    const dismissed = planStore.get("planDismissed");
    delete dismissed[gitRoot];
    planStore.set("planDismissed", dismissed);
    // Clear the indexed flag so we can re-index
    const indexed = planStore.get("planIndexed");
    delete indexed[gitRoot];
    planStore.set("planIndexed", indexed);
    return getPlansForProject(gitRoot);
  });

  // IPC: poll plans directory for changes (renderer-side polling replaces fs.watch)
  ipcMain.handle("plan:pollDirectory", () => {
    const result = { newFiles: [] as string[], changedFiles: [] as string[], deletedFiles: [] as string[] };
    try {
      if (!fs.existsSync(plansDirectory)) return result;
      const currentFiles = new Set<string>();
      for (const file of fs.readdirSync(plansDirectory)) {
        if (!file.endsWith(".md")) continue;
        currentFiles.add(file);
        const existing = planIndex.get(file);
        if (!existing) {
          indexPlanFile(path.join(plansDirectory, file));
          result.newFiles.push(file);
        } else {
          try {
            const stat = fs.statSync(path.join(plansDirectory, file));
            if (stat.mtimeMs !== existing.mtime) {
              indexPlanFile(path.join(plansDirectory, file));
              result.changedFiles.push(file);
            }
          } catch { /* deleted between readdir and stat */ }
        }
      }
      for (const [name] of planIndex) {
        if (!currentFiles.has(name)) { planIndex.delete(name); result.deletedFiles.push(name); }
      }
    } catch { /* directory inaccessible */ }

    // Prune deleted files from persistent store so stale entries don't linger
    for (const filename of result.deletedFiles) {
      pruneDeletedPlan(filename);
    }

    if (result.newFiles.length > 0 || result.changedFiles.length > 0 || result.deletedFiles.length > 0) {
      console.log('[plans-poll] directory diff:', result);
    }
    return result;
  });

  // IPC: index plans for project (AI-powered, reads CLAUDE.md for context)
  // Skips plans already classified for this project. Use plan:resetIndex to force re-classification.
  let planIndexInProgress: Promise<unknown> | null = null;
  ipcMain.handle("plan:indexForProject", async (_event, gitRoot: string) => {
    // Concurrency guard: wait for any in-progress indexing, then check if work remains
    if (planIndexInProgress) {
      await planIndexInProgress;
    }

    // Determine which plans still need classification for this project
    // Only consider plans from the last 7 days (to avoid overwhelming the AI)
    const allClassified = planStore.get("planClassified");
    const planIndexed = planStore.get("planIndexed");
    console.log(`[plans] indexForProject: gitRoot=${gitRoot}, planIndexed=`, planIndexed);
    const projectDecisions = allClassified[gitRoot] ?? {};

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toClassify: string[] = [];
    for (const [filename, entry] of planIndex) {
      if (!(filename in projectDecisions) && entry.mtime >= sevenDaysAgo) {
        toClassify.push(filename);
      }
    }
    console.log(`[plans] toClassify: ${toClassify.length} files, planIndexed[gitRoot]=`, planIndexed[gitRoot]);

    // If already indexed AND no new files to classify, skip
    if (planIndexed[gitRoot] && toClassify.length === 0) {
      console.log(`[plans] indexForProject(${gitRoot}): already indexed, no new files`);
      return getPlansForProject(gitRoot);
    }

    // Mark as indexed so we don't re-run on every startup (but allow new file detection)
    if (!planIndexed[gitRoot]) {
      planIndexed[gitRoot] = true;
      planStore.set("planIndexed", planIndexed);
      console.log(`[plans] marked as indexed: ${gitRoot}`);
    }

    if (toClassify.length === 0) {
      console.log(`[plans] indexForProject(${gitRoot}): no recent plans to classify`);
      return getPlansForProject(gitRoot);
    }

    console.log(`[plans] classifying ${toClassify.length} recent plan(s) for ${gitRoot}`);

    const claude = detectClaudeCode();
    if (!claude) return getPlansForProject(gitRoot);

    // Read CLAUDE.md for project context (try root, then .claude/ subdirectory)
    let claudeMdContent = "";
    for (const candidate of [
      path.join(gitRoot, "CLAUDE.md"),
      path.join(gitRoot, ".claude", "CLAUDE.md"),
    ]) {
      try {
        claudeMdContent = fs.readFileSync(candidate, "utf-8");
        break;
      } catch { /* try next */ }
    }

    // Build plan list for unclassified plans only
    const planLines: string[] = [];
    for (const filename of toClassify) {
      const entry = planIndex.get(filename);
      if (!entry) continue;
      let contentPreview = "";
      try {
        const content = fs.readFileSync(entry.absolutePath, "utf-8");
        // Get first meaningful content (skip title, separators, empty lines)
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
          // Get more context - first few lines of actual content
          contentPreview = trimmed.substring(0, 500);
          break;
        }
      } catch { /* ignore */ }
      planLines.push(`- ${filename}: ${entry.title || "(no title)"}${contentPreview ? ` — ${contentPreview}` : ""}`);
    }

    if (planLines.length === 0) {
      return getPlansForProject(gitRoot);
    }

    // Build prompt using CLAUDE.md content (or fall back to folder name)
    let projectContext: string;
    if (claudeMdContent) {
      // Include more CLAUDE.md context for better classification
      const truncated = claudeMdContent.substring(0, 6000);
      projectContext = `Here is the CLAUDE.md for the project at ${gitRoot}:\n---\n${truncated}\n---`;
    } else {
      projectContext = `The project is "${path.basename(gitRoot)}" at ${gitRoot}.`;
    }

    const prompt = `${projectContext}

Which of these plan files belong to this project?

IMPORTANT: Plans recently created (in the last 24 hours) are likely related to this project since they were likely created while working on it. Consider recently-created plans as related unless clearly unrelated.

${planLines.join("\n")}

Return ONLY: {"related": ["filename.md"]}`;

    const doIndex = (async () => {
      try {
        const result = await new Promise<string[]>((resolve) => {
          let proc: ChildProcess | null = null;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          try {
            proc = spawn(
              claude.path,
              ["-p", "--model", "haiku", "--output-format", "json"],
              {
                cwd: gitRoot,
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env },
              }
            );

            if (proc.stdin) {
              proc.stdin.write(prompt);
              proc.stdin.end();
            }

            let stdout = "";
            proc.stdout?.on("data", (chunk: Buffer) => {
              stdout += chunk.toString();
            });

            timeoutId = setTimeout(() => {
              if (proc && !proc.killed) proc.kill("SIGTERM");
              resolve([]);
            }, 30000);

            proc.on("error", () => {
              if (timeoutId) clearTimeout(timeoutId);
              resolve([]);
            });

            proc.on("close", (code) => {
              if (timeoutId) clearTimeout(timeoutId);
              if (code !== 0) { resolve([]); return; }

              try {
                const trimmed = stdout.trim();
                let inner: string;
                try {
                  const envelope = JSON.parse(trimmed);
                  if (envelope && typeof envelope.result === "string") {
                    inner = envelope.result;
                  } else if (envelope && Array.isArray(envelope.related)) {
                    resolve(envelope.related.filter((f: unknown) => typeof f === "string"));
                    return;
                  } else {
                    resolve([]);
                    return;
                  }
                } catch {
                  inner = trimmed;
                }

                let cleaned = inner.trim();
                if (cleaned.startsWith("```")) {
                  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
                }

                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed.related)) {
                  resolve(parsed.related.filter((f: unknown) => typeof f === "string"));
                } else {
                  resolve([]);
                }
              } catch {
                resolve([]);
              }
            });
          } catch {
            resolve([]);
          }
        });

        // Store per-plan decisions: store TRUE for related, FALSE for unrelated.
        // This prevents re-classifying the same plans on every startup.
        const relatedSet = new Set(result);
        for (const filename of toClassify) {
          projectDecisions[filename] = relatedSet.has(filename);
        }
        allClassified[gitRoot] = projectDecisions;
        planStore.set("planClassified", allClassified);

        // Mark as indexed so we don't re-index on next startup
        const indexed = planStore.get("planIndexed");
        indexed[gitRoot] = true;
        planStore.set("planIndexed", indexed);

        console.log(`[plans] classified: ${result.length} related, ${toClassify.length - result.length} unrelated`);
      } catch {
        // Classification failed — don't store decisions so we retry next time
      }
    })();

    planIndexInProgress = doIndex;
    try {
      await doIndex;
    } finally {
      planIndexInProgress = null;
    }
    return getPlansForProject(gitRoot);
  });

}

/**
 * Remove all IPC handlers (for cleanup)
 */
function removeIpcHandlers(): void {
  // Terminal handlers
  ipcMain.removeHandler("terminal:create");
  ipcMain.removeHandler("terminal:input");
  ipcMain.removeHandler("terminal:resize");
  ipcMain.removeHandler("terminal:getContent");
  ipcMain.removeHandler("terminal:close");
  ipcMain.removeHandler("terminal:isActive");
  ipcMain.removeHandler("terminal:list");
  ipcMain.removeHandler("terminal:getProcess");
  ipcMain.removeHandler("terminal:checkSandboxAvailability");
  ipcMain.removeHandler("terminal:setSandboxMode");

  // Shell handlers
  ipcMain.removeHandler("shell:openExternal");

  // File handlers
  ipcMain.removeHandler("file:read");
  ipcMain.removeHandler("file:write");
  ipcMain.removeHandler("file:stat");
  ipcMain.removeHandler("file:readdir");
  ipcMain.removeHandler("file:mkdir");
  ipcMain.removeHandler("file:rename");
  ipcMain.removeHandler("file:trash");
  ipcMain.removeHandler("file:showInFolder");
  ipcMain.removeHandler("git:showFile");
  ipcMain.removeHandler("git:getRoot");
  ipcMain.removeHandler("git:checkIgnore");
  ipcMain.removeHandler("git:getCommits");
  ipcMain.removeHandler("git:listMarkdownFiles");
  ipcMain.removeHandler("context:discoverMemoryFiles");

  // MCP handlers
  ipcMain.removeHandler("mcp:getStatus");
  ipcMain.removeHandler("mcp:start");
  ipcMain.removeHandler("mcp:stop");
  ipcMain.removeHandler("mcp:attach");
  ipcMain.removeHandler("mcp:detach");
  ipcMain.removeHandler("mcp:getAttached");
  ipcMain.removeHandler("mcp:getClients");
  ipcMain.removeHandler("mcp:disconnectClient");

  // IDE Protocol handlers
  ipcMain.removeHandler("ide:getStatus");
  ipcMain.removeHandler("ide:reportSelection");
  ipcMain.removeHandler("ide:addFragment");
  ipcMain.removeHandler("ide:removeFragment");
  ipcMain.removeHandler("ide:clearFragments");
  ipcMain.removeHandler("ide:reportFileOpen");
  ipcMain.removeAllListeners("ide:selectionResponse");
  ipcMain.removeHandler("ide:restart");
  ipcMain.removeHandler("ide:updateWorkspaceFolders");

  // Claude info handlers
  ipcMain.removeHandler("claude:getInfo");

  // Window handlers
  ipcMain.removeHandler("window:create");

  // Analytics handlers
  ipcMain.removeHandler("analytics:getConsent");
  ipcMain.removeHandler("analytics:setConsent");
  ipcMain.removeHandler("analytics:hasSeenWelcome");
  ipcMain.removeHandler("analytics:markWelcomeSeen");
  ipcMain.removeHandler("analytics:track");
  ipcMain.removeHandler("analytics:submitFeedback");

  // Plan handlers
  ipcMain.removeHandler("plan:getForProject");
  ipcMain.removeHandler("plan:indexForProject");
  ipcMain.removeHandler("plan:dismiss");
  ipcMain.removeHandler("plan:resetIndex");
  ipcMain.removeHandler("plan:pollDirectory");

  // Updater handlers
  ipcMain.removeHandler("updater:check");
  ipcMain.removeHandler("updater:download");
  ipcMain.removeHandler("updater:install");
  ipcMain.removeHandler("updater:getStatus");
}

// Disable GPU if environment signals no display server (headless/VM)
// This prevents repeated GPU process crashes on machines without proper drivers.
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  app.disableHardwareAcceleration();
}

// Handle GPU process crashes gracefully instead of exiting
app.on("child-process-gone", (_event, details) => {
  if (details.type === "GPU" && details.reason !== "clean-exit") {
    console.warn(`[main] GPU process gone (reason: ${details.reason}), disabling hardware acceleration`);
    // Electron will fall back to software rendering automatically after GPU crash
  }
});

// App lifecycle
_mark("module init done");

app.whenReady().then(async () => {
  _mark("app.whenReady()");
  // On Linux, prepend bundled sandbox binaries (socat, bwrap) to PATH so that
  // @anthropic-ai/sandbox-runtime can find them without requiring system install.
  if (process.platform === "linux") {
    const binDir = path.join(process.resourcesPath, "bin");
    if (fs.existsSync(binDir)) {
      process.env.PATH = `${binDir}:${process.env.PATH}`;
    }
  }

  // Prevent macOS from killing the app via sudden termination (SIGKILL)
  // so our before-quit cleanup path always runs (PTY handle draining).
  if (process.platform === "darwin") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const macApp = app as any;
    if (typeof macApp.disableSuddenTermination === "function") {
      macApp.disableSuddenTermination();
    }
  }

  // Dev flag: --reset-welcome to re-trigger onboarding flow
  if (process.argv.includes("--reset-welcome")) {
    resetWelcomeSeen();
    console.log("[main] Welcome state reset via --reset-welcome flag");
  }


  // Initialize analytics (consent-aware)
  initAnalytics();

  // Initialize settings IPC handlers
  initSettingsHandlers();

  // Allow media (microphone) permissions when requested by renderer.
  // Claude Code /voice uses a native CoreAudio module in the child process;
  // triggering getUserMedia from the renderer is the reliable way to get macOS
  // TCC to prompt for microphone access on the host app.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "clipboard-read");
  });

  // Create window manager
  windowManager = new WindowManager();

  // Register all IPC handlers once at app startup
  registerIpcHandlers(windowManager);
  _mark("IPC handlers registered");

  // Set up application menu (uses WindowManager for "New Window" and routing)
  createMenu(windowManager);

  // Create the first window
  await windowManager.createWindow();
  _mark("first window created");

  // Request microphone access so voice features (e.g. Claude Code /voice) work.
  // Claude Code uses a native CoreAudio module — the macOS TCC permission must
  // be granted to the host app (Electron/brosh).  We trigger getUserMedia from
  // the renderer which goes through Chromium's permission path and reliably
  // triggers the macOS TCC prompt (systemPreferences.askForMediaAccess fails
  // silently for ad-hoc signed dev builds on macOS Sequoia).
  if (process.platform === "darwin") {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    console.log(`[main] Microphone TCC status: ${micStatus}`);
    if (micStatus !== "granted") {
      const firstManaged = windowManager.getAllWindows()[0];
      if (firstManaged) {
        firstManaged.window.webContents.executeJavaScript(`
          navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
              stream.getTracks().forEach(t => t.stop());
              console.log('[mic] Microphone access granted');
            })
            .catch(err => console.warn('[mic] Microphone access denied:', err.message));
        `).catch(() => {});
      }
    }
  }

  // Log startup timings
  console.log("\n[startup] Timing breakdown:");
  for (const [label, ms] of _startupTimings) {
    console.log(`  ${ms.toFixed(0).padStart(6)}ms  ${label}`);
  }
  console.log();

  // Initialize auto-updater (only in packaged builds)
  if (app.isPackaged) {
    initAutoUpdater(windowManager);
  }

  // System sleep/wake handlers for battery optimization
  powerMonitor.on('suspend', async () => {
    console.log('[main] System suspending - pausing background activities');
    // Close git watcher to save resources during sleep
    if (gitWatcher) {
      await gitWatcher.close();
      gitWatcher = null;
    }
    // Pause file watchers
    fileWatchSuspended = true;
    stopAllFileWatchers();
    // Pause update checks during sleep
    stopPeriodicCheck();
    // Notify all windows to pause activities
    windowManager?.handleSystemSuspend();
  });

  powerMonitor.on('resume', async () => {
    console.log('[main] System resumed - restarting background activities');
    // Restart git watcher
    if (setupGitWatcher) {
      await setupGitWatcher();
    }
    // Resume file watchers (if renderer still wants them)
    fileWatchSuspended = false;
    if (windowManager && fileWatchDesiredDirs.length > 0) {
      reconcileFileWatchers(windowManager);
    }
    // Resume update checks
    if (app.isPackaged) {
      startPeriodicCheck();
    }
    // Notify all windows to resume activities
    windowManager?.handleSystemResume();
  });

  // Display sleep handlers (lid close / screen lock while plugged into power)
  // On macOS, closing the lid while on AC power may NOT trigger 'suspend' —
  // the system stays awake in "display sleep" mode. All timers, PTY handlers,
  // and IPC keep running, burning CPU to paint invisible frames.
  // Treat lock-screen the same as suspend to throttle background work.
  powerMonitor.on('lock-screen', async () => {
    console.log('[main] Screen locked - pausing background activities');
    if (gitWatcher) {
      await gitWatcher.close();
      gitWatcher = null;
    }
    fileWatchSuspended = true;
    stopAllFileWatchers();
    stopPeriodicCheck();
    windowManager?.handleSystemSuspend();
  });

  powerMonitor.on('unlock-screen', async () => {
    console.log('[main] Screen unlocked - restarting background activities');
    if (setupGitWatcher) {
      await setupGitWatcher();
    }
    fileWatchSuspended = false;
    if (windowManager && fileWatchDesiredDirs.length > 0) {
      reconcileFileWatchers(windowManager);
    }
    if (app.isPackaged) {
      startPeriodicCheck();
    }
    windowManager?.handleSystemResume();
  });

  app.on("activate", async () => {
    // On macOS, re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
      await windowManager.createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS, keep app running until explicitly quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Guard to allow the second app.quit() call through after cleanup completes
let quitCleanupDone = false;

app.on("before-quit", (event) => {
  if (quitCleanupDone) return; // Cleanup done, allow quit to proceed

  // Prevent quit so we can do async cleanup first.
  // Without this, Electron proceeds to FreeEnvironment while node-pty's
  // native ThreadSafeFunction handles are still alive, causing SIGABRT.
  event.preventDefault();
  quitCleanupDone = true;

  (async () => {
    // Shutdown analytics first (flushes pending events)
    await shutdownAnalytics();

    if (windowManager) {
      windowManager.dispose(); // Kills all PTY processes
      windowManager = null;
    }
    removeIpcHandlers();

    // Wait for node-pty native UV handles to drain after PTY kill signals.
    // node-pty uses a ThreadSafeFunction that calls back into JS from a
    // background I/O thread. If FreeEnvironment runs while these handles
    // are still pending, the callback fires into a destroyed JS env,
    // causing Napi::Error::ThrowAsJavaScriptException → abort().
    await new Promise((resolve) => setTimeout(resolve, 200));

    app.quit();
  })().catch((err) => {
    console.error("[main] Error during quit cleanup:", err);
    app.exit(1); // Force exit if cleanup fails
  });
});


// Export for testing
export { windowManager };
