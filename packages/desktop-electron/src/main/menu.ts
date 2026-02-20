/**
 * Application Menu
 *
 * Defines the native menu bar for the application.
 */

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import type { WindowManager } from "./window-manager.js";

const isMac = process.platform === "darwin";

/**
 * Get the currently focused window, or the first window if none focused
 */
function getActiveWindow(windowManager: WindowManager): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return focused;

  // Fall back to first window
  const windows = windowManager.getAllWindows();
  return windows.length > 0 ? windows[0].window : null;
}

export function createMenu(windowManager: WindowManager): void {
  // Helper to send to active window
  const sendToActive = (channel: string) => {
    const window = getActiveWindow(windowManager);
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel);
    }
  };
  const template: MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              {
                label: "Check for Updates...",
                click: async () => {
                  const { checkForUpdates } = await import("./auto-updater.js");
                  checkForUpdates();
                },
              },
              { type: "separator" as const },
              {
                label: "Preferences...",
                accelerator: "CmdOrCtrl+,",
                click: () => sendToActive("menu:preferences"),
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),

    // File menu
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            windowManager.createWindow();
          },
        },
        { type: "separator" },
        {
          label: "Split Right",
          accelerator: "CmdOrCtrl+D",
          click: () => sendToActive("menu:splitRight"),
        },
        {
          label: "Split Down",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => sendToActive("menu:splitDown"),
        },
        { type: "separator" },
        {
          label: "Close Pane",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToActive("menu:closeTerminal"),
        },
        ...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },

    // Edit menu
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Clear Terminal",
          accelerator: "CmdOrCtrl+K",
          click: () => sendToActive("menu:clearTerminal"),
        },
      ],
    },

    // View menu
    {
      label: "View",
      submenu: [
        ...(!app.isPackaged
          ? [
              { role: "reload" as const },
              { role: "forceReload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },

    // Terminal menu
    {
      label: "Terminal",
      submenu: [
        {
          label: "Scroll to Top",
          accelerator: "CmdOrCtrl+Home",
          click: () => sendToActive("menu:scrollToTop"),
        },
        {
          label: "Scroll to Bottom",
          accelerator: "CmdOrCtrl+End",
          click: () => sendToActive("menu:scrollToBottom"),
        },
      ],
    },

    // Window menu
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },

    // Help menu
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: async () => {
            await shell.openExternal("https://github.com/elleryfamilia/brosh#readme");
          },
        },
        {
          label: "Report Issue",
          click: async () => {
            await shell.openExternal("https://github.com/elleryfamilia/brosh/issues");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
