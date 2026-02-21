/**
 * Auto-Updater Module
 *
 * Manages automatic update checking, downloading, and installation
 * using electron-updater with GitHub Releases as the update source.
 *
 * Singleton pattern matching analytics.ts.
 */

import { app, shell, ipcMain } from "electron";
import { readFileSync } from "fs";
import { join } from "path";
import electronUpdater from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";

const { autoUpdater } = electronUpdater;
import type { WindowManager } from "./window-manager.js";
import { getSettings } from "./settings-store.js";

/**
 * Detect local (non-release) builds.
 * electron-builder's -c.extraMetadata.localBuild=true embeds the flag
 * in the packaged app's package.json. CI/release builds don't set it.
 */
function isLocalBuild(): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(join(app.getAppPath(), "package.json"), "utf8")
    );
    return pkg.localBuild === true || pkg.localBuild === "true";
  } catch {
    return false;
  }
}

// Update status types
export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
  /** True when code signing is missing and auto-update can't install */
  manualRequired?: boolean;
}

// Module state
let windowManager: WindowManager | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let currentStatus: UpdateStatus = {
  state: "idle",
  currentVersion: app.getVersion(),
};

// Whether the last check was user-initiated (show errors) or automatic (silent errors)
let isManualCheck = false;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_DELAY_MS = 10_000; // 10 seconds

/**
 * Broadcast update status to all renderer windows
 */
function broadcastStatus(status: UpdateStatus): void {
  currentStatus = status;
  windowManager?.broadcast("updater:status", status);
}

/**
 * Initialize the auto-updater.
 * Should only be called when app.isPackaged is true.
 */
export function initAutoUpdater(wm: WindowManager): void {
  windowManager = wm;

  // Skip auto-updates for local builds (npm run package:mac, etc.)
  // Only GitHub-released builds should check for updates.
  if (isLocalBuild()) {
    console.log("[auto-updater] Local build detected, skipping auto-updates");
    return;
  }

  // Configure autoUpdater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Event: update available
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    broadcastStatus({
      state: "available",
      currentVersion: app.getVersion(),
      availableVersion: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string"
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((n) => n.note).join("\n")
            : undefined,
      releaseDate: info.releaseDate,
    });
  });

  // Event: no update available
  autoUpdater.on("update-not-available", (_info: UpdateInfo) => {
    broadcastStatus({
      state: "not-available",
      currentVersion: app.getVersion(),
    });
  });

  // Event: download progress
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    broadcastStatus({
      ...currentStatus,
      state: "downloading",
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  // Event: update downloaded and ready to install
  autoUpdater.on("update-downloaded", (_info: UpdateInfo) => {
    broadcastStatus({
      ...currentStatus,
      state: "downloaded",
      progress: undefined,
    });
  });

  // Event: error
  autoUpdater.on("error", (err: Error) => {
    const errorMsg = err.message || "Unknown update error";
    const isCodeSignError =
      errorMsg.includes("Code signature") ||
      errorMsg.includes("could not be validated") ||
      errorMsg.includes("ERR_UPDATER_INVALID_UPDATE_SIGNATURE");

    if (isCodeSignError) {
      // macOS without code signing: fall back to manual update
      broadcastStatus({
        ...currentStatus,
        state: "available",
        manualRequired: true,
      });
      return;
    }

    // Only broadcast errors for manual checks; stay silent for periodic checks
    if (isManualCheck) {
      broadcastStatus({
        state: "error",
        currentVersion: app.getVersion(),
        error: errorMsg,
      });
    } else {
      // Reset to idle silently
      currentStatus = {
        state: "idle",
        currentVersion: app.getVersion(),
      };
    }
  });

  // Register IPC handlers
  ipcMain.handle("updater:check", async () => {
    isManualCheck = true;
    return checkForUpdates();
  });

  ipcMain.handle("updater:download", async () => {
    if (currentStatus.manualRequired) {
      // Can't auto-download without code signing; open release page
      const version = currentStatus.availableVersion || "latest";
      shell.openExternal(
        `https://github.com/elleryfamilia/brosh/releases/tag/v${version}`
      );
      return;
    }
    broadcastStatus({
      ...currentStatus,
      state: "downloading",
    });
    await autoUpdater.downloadUpdate();
  });

  ipcMain.handle("updater:install", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("updater:getStatus", () => {
    return currentStatus;
  });

  // Start periodic checking after a delay
  setTimeout(() => {
    const settings = getSettings();
    if (settings.advanced.autoUpdate !== false) {
      isManualCheck = false;
      checkForUpdates();
    }
    startPeriodicCheck();
  }, STARTUP_DELAY_MS);
}

/**
 * Check for updates.
 * Returns the current status for the caller.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  broadcastStatus({
    state: "checking",
    currentVersion: app.getVersion(),
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // Error is handled by the "error" event handler above
    console.error("[auto-updater] Check failed:", err);
  }

  return currentStatus;
}

/**
 * Start the periodic update check interval
 */
export function startPeriodicCheck(): void {
  if (periodicTimer) return;

  periodicTimer = setInterval(() => {
    const settings = getSettings();
    if (settings.advanced.autoUpdate !== false) {
      isManualCheck = false;
      checkForUpdates();
    }
  }, CHECK_INTERVAL_MS);

  // Don't keep the process alive just for update checks
  periodicTimer.unref?.();
}

/**
 * Stop the periodic update check interval
 */
export function stopPeriodicCheck(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
