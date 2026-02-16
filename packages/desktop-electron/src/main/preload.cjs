/**
 * Preload Script (CommonJS)
 *
 * Exposes a secure API to the renderer process via contextBridge.
 * This script runs in a sandboxed context with access to Node.js APIs
 * but exposes only specific, safe functionality to the renderer.
 */

const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Expose the API to the renderer
contextBridge.exposeInMainWorld("terminalAPI", {
  // Session management
  createSession: (options) => ipcRenderer.invoke("terminal:create", options),
  closeSession: (sessionId) => ipcRenderer.invoke("terminal:close", sessionId),
  isActive: (sessionId) => ipcRenderer.invoke("terminal:isActive", sessionId),
  listSessions: () => ipcRenderer.invoke("terminal:list"),

  // Terminal I/O
  input: (sessionId, data) => ipcRenderer.invoke("terminal:input", sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
  getContent: (sessionId) => ipcRenderer.invoke("terminal:getContent", sessionId),
  getProcess: (sessionId) => ipcRenderer.invoke("terminal:getProcess", sessionId),
  getCwd: (sessionId) => ipcRenderer.invoke("terminal:getCwd", sessionId),
  getHomedir: () => ipcRenderer.invoke("terminal:getHomedir"),

  // Event listeners
  onMessage: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("terminal:message", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("terminal:message", handler);
    };
  },

  onWindowResize: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("window:resize", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("window:resize", handler);
    };
  },

  // MCP server status
  mcpGetStatus: () => ipcRenderer.invoke("mcp:getStatus"),
  mcpStart: () => ipcRenderer.invoke("mcp:start"),
  mcpStop: () => ipcRenderer.invoke("mcp:stop"),
  onMcpStatusChanged: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("mcp:statusChanged", handler);
    return () => {
      ipcRenderer.removeListener("mcp:statusChanged", handler);
    };
  },

  // MCP session attachment
  mcpAttach: (sessionId) => ipcRenderer.invoke("mcp:attach", sessionId),
  mcpDetach: () => ipcRenderer.invoke("mcp:detach"),
  mcpGetAttached: () => ipcRenderer.invoke("mcp:getAttached"),
  mcpGetClients: () => ipcRenderer.invoke("mcp:getClients"),
  onMcpAttachmentChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mcp:attachmentChanged", handler);
    return () => {
      ipcRenderer.removeListener("mcp:attachmentChanged", handler);
    };
  },
  onMcpToolCallStarted: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mcp:toolCallStarted", handler);
    return () => {
      ipcRenderer.removeListener("mcp:toolCallStarted", handler);
    };
  },
  onMcpToolCallCompleted: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mcp:toolCallCompleted", handler);
    return () => {
      ipcRenderer.removeListener("mcp:toolCallCompleted", handler);
    };
  },
  onMcpClientConnected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mcp:clientConnected", handler);
    return () => {
      ipcRenderer.removeListener("mcp:clientConnected", handler);
    };
  },
  onMcpClientDisconnected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mcp:clientDisconnected", handler);
    return () => {
      ipcRenderer.removeListener("mcp:clientDisconnected", handler);
    };
  },
  mcpDisconnectClient: (clientId) => ipcRenderer.invoke("mcp:disconnectClient", clientId),
  onMcpSocketLost: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mcp:socketLost", handler);
    return () => {
      ipcRenderer.removeListener("mcp:socketLost", handler);
    };
  },

  // Sandbox mode
  setSandboxMode: (config) => ipcRenderer.invoke("terminal:setSandboxMode", config),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (updates) => ipcRenderer.invoke("settings:update", updates),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  setWindowOpacity: (opacity) => ipcRenderer.invoke("settings:setWindowOpacity", opacity),

  // Claude Code status
  isClaudeCodeInstalled: () => ipcRenderer.invoke("ai:isClaudeCodeInstalled"),
  getClaudeStatus: () => ipcRenderer.invoke("ai:getClaudeStatus"),
  setClaudeModel: (model) => ipcRenderer.invoke("ai:setClaudeModel", model),
  getClaudeSessionId: (terminalSessionId) => ipcRenderer.invoke("ai:getClaudeSessionId", terminalSessionId),
  onClaudeSessionChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("terminal:claudeSessionChanged", handler);
    return () => ipcRenderer.removeListener("terminal:claudeSessionChanged", handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on("settings:changed", handler);
    return () => {
      ipcRenderer.removeListener("settings:changed", handler);
    };
  },

  // Real-time input mode feedback
  onInputModeChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("terminal:inputModeChanged", handler);
    return () => {
      ipcRenderer.removeListener("terminal:inputModeChanged", handler);
    };
  },

  // Typo suggestion feedback (shown after Enter when typo detected)
  onTypoSuggestion: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("terminal:typoSuggestion", handler);
    return () => {
      ipcRenderer.removeListener("terminal:typoSuggestion", handler);
    };
  },

  // Autocomplete suggestion feedback (shown while typing)
  onAutocomplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("terminal:autocomplete", handler);
    return () => {
      ipcRenderer.removeListener("terminal:autocomplete", handler);
    };
  },

  // Menu events
  onMenuPreferences: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("menu:preferences", handler);
    return () => {
      ipcRenderer.removeListener("menu:preferences", handler);
    };
  },

  // Window management
  createWindow: () => ipcRenderer.invoke("window:create"),

  // Shell utilities
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  // File utilities (for drag and drop)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // File reading (for editor pane)
  readFile: (filePath) => ipcRenderer.invoke("file:read", filePath),
  statFile: (filePath) => ipcRenderer.invoke("file:stat", filePath),
  gitShowFile: (filePath, ref) => ipcRenderer.invoke("git:showFile", filePath, ref),
  writeFile: (filePath, content) => ipcRenderer.invoke("file:write", filePath, content),
  gitListMarkdownFiles: (cwd) => ipcRenderer.invoke("git:listMarkdownFiles", cwd),
  discoverMemoryFiles: (cwd) => ipcRenderer.invoke("context:discoverMemoryFiles", cwd),

  // Git status (for status bar)
  getGitStatus: (cwd) => ipcRenderer.invoke("git:getStatus", cwd),
  onGitChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("git:changed", handler);
    return () => ipcRenderer.removeListener("git:changed", handler);
  },

  // Git root
  getGitRoot: (cwd) => ipcRenderer.invoke("git:getRoot", cwd),

  // Git commits
  getGitCommits: (cwd, count) => ipcRenderer.invoke("git:getCommits", cwd, count),

  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke("updater:check"),
  updaterDownload: () => ipcRenderer.invoke("updater:download"),
  updaterInstall: () => ipcRenderer.invoke("updater:install"),
  updaterGetStatus: () => ipcRenderer.invoke("updater:getStatus"),
  onUpdaterStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("updater:status", handler);
    return () => {
      ipcRenderer.removeListener("updater:status", handler);
    };
  },

  // IDE Protocol
  ideRestart: (cwd) => ipcRenderer.invoke("ide:restart", cwd),
  ideUpdateWorkspaceFolders: (cwd) => ipcRenderer.invoke("ide:updateWorkspaceFolders", cwd),
  ideReportSelection: (sessionId, text) => ipcRenderer.invoke("ide:reportSelection", sessionId, text),
  ideReportFileOpen: (filePath) => ipcRenderer.invoke("ide:reportFileOpen", filePath),
  onIdeRequestSelection: (callback) => {
    const handler = (_event, requestId) => callback(requestId);
    ipcRenderer.on("ide:requestSelection", handler);
    return () => ipcRenderer.removeListener("ide:requestSelection", handler);
  },
  ideSelectionResponse: (requestId, sessionId, text) => ipcRenderer.send("ide:selectionResponse", requestId, sessionId, text),
  onIdeOpenFile: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ide:openFile", handler);
    return () => ipcRenderer.removeListener("ide:openFile", handler);
  },
  onIdeOpenDiff: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ide:openDiff", handler);
    return () => ipcRenderer.removeListener("ide:openDiff", handler);
  },
  ideAddFragment: (sessionId, text) => ipcRenderer.invoke("ide:addFragment", sessionId, text),
  ideRemoveFragment: (index) => ipcRenderer.invoke("ide:removeFragment", index),
  ideClearFragments: () => ipcRenderer.invoke("ide:clearFragments"),
  onIdeFragmentsChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ide:fragmentsChanged", handler);
    return () => ipcRenderer.removeListener("ide:fragmentsChanged", handler);
  },

  // Claude Code info
  claudeGetInfo: () => ipcRenderer.invoke("claude:getInfo"),
  onClaudeInfoChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("claude:infoChanged", handler);
    return () => ipcRenderer.removeListener("claude:infoChanged", handler);
  },
  onIdeClientDisconnected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ide:clientDisconnected", handler);
    return () => ipcRenderer.removeListener("ide:clientDisconnected", handler);
  },

  // Plans
  getPlansForProject: (gitRoot) => ipcRenderer.invoke("plan:getForProject", gitRoot),
  indexPlansForProject: (gitRoot) => ipcRenderer.invoke("plan:indexForProject", gitRoot),
  dismissPlan: (gitRoot, filename) => ipcRenderer.invoke("plan:dismiss", gitRoot, filename),
  resetPlanIndex: (gitRoot) => ipcRenderer.invoke("plan:resetIndex", gitRoot),
  onPlanChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("plan:changed", handler);
    return () => {
      ipcRenderer.removeListener("plan:changed", handler);
    };
  },

  // Analytics
  analyticsGetConsent: () => ipcRenderer.invoke("analytics:getConsent"),
  analyticsSetConsent: (enabled) => ipcRenderer.invoke("analytics:setConsent", enabled),
  analyticsHasSeenWelcome: () => ipcRenderer.invoke("analytics:hasSeenWelcome"),
  analyticsMarkWelcomeSeen: () => ipcRenderer.invoke("analytics:markWelcomeSeen"),
  analyticsTrack: (event, properties) => ipcRenderer.invoke("analytics:track", event, properties),
  analyticsSubmitFeedback: (category, message, email) => ipcRenderer.invoke("analytics:submitFeedback", category, message, email),
});
