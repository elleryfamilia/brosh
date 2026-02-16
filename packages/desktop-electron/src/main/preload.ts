/**
 * Preload Script
 *
 * Exposes a secure API to the renderer process via contextBridge.
 * This script runs in a sandboxed context with access to Node.js APIs
 * but exposes only specific, safe functionality to the renderer.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";

// Type definitions for the exposed API
export interface TerminalAPI {
  // Session management
  createSession: (options?: {
    cols?: number;
    rows?: number;
    shell?: string;
    cwd?: string;
  }) => Promise<{
    success: boolean;
    sessionId?: string;
    cols?: number;
    rows?: number;
    error?: string;
  }>;

  closeSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;

  isActive: (sessionId: string) => Promise<boolean>;

  // Terminal I/O
  input: (sessionId: string, data: string) => Promise<{ success: boolean; error?: string }>;

  resize: (
    sessionId: string,
    cols: number,
    rows: number
  ) => Promise<{ success: boolean; error?: string }>;

  getContent: (sessionId: string) => Promise<{
    success: boolean;
    content?: string;
    cursor?: { x: number; y: number };
    dimensions?: { cols: number; rows: number };
    error?: string;
  }>;

  getCwd: (sessionId: string) => Promise<{
    success: boolean;
    cwd?: string;
    error?: string;
  }>;

  // Event listeners
  onMessage: (callback: (message: unknown) => void) => () => void;
  onWindowResize: (callback: () => void) => () => void;

  // Shell utilities
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

  // File utilities
  getPathForFile: (file: File) => string;

  // IDE Protocol
  ideReportSelection: (sessionId: string, text: string) => Promise<void>;
  ideReportFileOpen: (filePath: string) => Promise<void>;
  onIdeRequestSelection: (callback: (requestId: string) => void) => () => void;
  ideSelectionResponse: (requestId: string, sessionId: string, text: string) => void;
  onIdeOpenFile: (callback: (data: { filePath: string }) => void) => () => void;
  onIdeOpenDiff: (callback: (data: { oldContent: string; newContent: string; filePath: string }) => void) => () => void;
  ideAddFragment: (sessionId: string, text: string) => Promise<void>;
  ideRemoveFragment: (index: number) => Promise<void>;
  ideClearFragments: () => Promise<void>;
  onIdeFragmentsChanged: (callback: (data: { fragments: Array<{ index: number; sessionId: string; preview: string; lineCount: number }> }) => void) => () => void;
}

// Expose the API to the renderer
contextBridge.exposeInMainWorld("terminalAPI", {
  // Session management
  createSession: (options) => ipcRenderer.invoke("terminal:create", options),
  closeSession: (sessionId) => ipcRenderer.invoke("terminal:close", sessionId),
  isActive: (sessionId) => ipcRenderer.invoke("terminal:isActive", sessionId),

  // Terminal I/O
  input: (sessionId, data) => ipcRenderer.invoke("terminal:input", sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
  getContent: (sessionId) => ipcRenderer.invoke("terminal:getContent", sessionId),
  getCwd: (sessionId) => ipcRenderer.invoke("terminal:getCwd", sessionId),

  // Event listeners
  onMessage: (callback: (message: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) => callback(message);
    ipcRenderer.on("terminal:message", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("terminal:message", handler);
    };
  },

  onWindowResize: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("window:resize", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("window:resize", handler);
    };
  },

  // Shell utilities
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  // File utilities
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // IDE Protocol
  ideReportSelection: (sessionId: string, text: string) => ipcRenderer.invoke("ide:reportSelection", sessionId, text),
  ideReportFileOpen: (filePath: string) => ipcRenderer.invoke("ide:reportFileOpen", filePath),
  onIdeRequestSelection: (callback: (requestId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: string) => callback(requestId);
    ipcRenderer.on("ide:requestSelection", handler);
    return () => ipcRenderer.removeListener("ide:requestSelection", handler);
  },
  ideSelectionResponse: (requestId: string, sessionId: string, text: string) => ipcRenderer.send("ide:selectionResponse", requestId, sessionId, text),
  onIdeOpenFile: (callback: (data: { filePath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { filePath: string }) => callback(data);
    ipcRenderer.on("ide:openFile", handler);
    return () => ipcRenderer.removeListener("ide:openFile", handler);
  },
  onIdeOpenDiff: (callback: (data: { oldContent: string; newContent: string; filePath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { oldContent: string; newContent: string; filePath: string }) => callback(data);
    ipcRenderer.on("ide:openDiff", handler);
    return () => ipcRenderer.removeListener("ide:openDiff", handler);
  },
  ideAddFragment: (sessionId: string, text: string) => ipcRenderer.invoke("ide:addFragment", sessionId, text),
  ideRemoveFragment: (index: number) => ipcRenderer.invoke("ide:removeFragment", index),
  ideClearFragments: () => ipcRenderer.invoke("ide:clearFragments"),
  onIdeFragmentsChanged: (callback: (data: { fragments: Array<{ index: number; sessionId: string; preview: string; lineCount: number }> }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { fragments: Array<{ index: number; sessionId: string; preview: string; lineCount: number }> }) => callback(data);
    ipcRenderer.on("ide:fragmentsChanged", handler);
    return () => ipcRenderer.removeListener("ide:fragmentsChanged", handler);
  },
} satisfies TerminalAPI);

// Type augmentation for the window object
declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}
