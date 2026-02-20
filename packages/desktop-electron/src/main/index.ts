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

import os from "os";
import path from "path";
import fs from "fs";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { app, BrowserWindow, ipcMain, shell, powerMonitor } from "electron";
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

// Set app name for menu bar (productName in build config only applies when packaged)
app.setName("brosh");

// Global window manager
let windowManager: WindowManager | null = null;

// Git watcher references (moved to module scope for powerMonitor access)
let gitWatcher: import("chokidar").FSWatcher | null = null;
let setupGitWatcher: (() => Promise<void>) | null = null;


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

  ipcMain.handle("ai:getClaudeSessionId", (event, terminalSessionId: string) => {
    const bridge = wm.getBridge(event.sender);
    if (!bridge) return null;
    return bridge.getClaudeSessionId(terminalSessionId);
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
app.whenReady().then(async () => {
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

  // Initialize analytics (consent-aware)
  initAnalytics();

  // Initialize settings IPC handlers
  initSettingsHandlers();

  // Create window manager
  windowManager = new WindowManager();

  // Register all IPC handlers once at app startup
  registerIpcHandlers(windowManager);

  // Set up application menu (uses WindowManager for "New Window" and routing)
  createMenu(windowManager);

  // Create the first window
  await windowManager.createWindow();

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
    stopPeriodicCheck();
    windowManager?.handleSystemSuspend();
  });

  powerMonitor.on('unlock-screen', async () => {
    console.log('[main] Screen unlocked - restarting background activities');
    if (setupGitWatcher) {
      await setupGitWatcher();
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
