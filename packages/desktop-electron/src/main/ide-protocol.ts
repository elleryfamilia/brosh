/**
 * IDE Protocol Server
 *
 * WebSocket-based server implementing the Claude Code IDE protocol.
 * Enables Claude Code CLI to auto-discover brosh as a first-class IDE
 * via lock file at ~/.claude/ide/{port}.lock.
 *
 * This is an app-scoped singleton — one IDE protocol server shared across all windows.
 * Uses WindowManager to broadcast events to all windows.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import * as crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { WindowManager } from "./window-manager.js";

/** Diagnostic entry from terminal error triage */
export interface IdeDiagnostic {
  sessionId: string;
  exitCode: number;
  command: string;
  summary: string;
  timestamp: number;
}

/** Lock file content written to ~/.claude/ide/{port}.lock */
interface LockFileContent {
  pid: number;
  workspaceFolders: string[];
  ideName: string;
  transport: "ws";
  runningInWindows: boolean;
  authToken: string;
  port: number;
}

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** JSON-RPC 2.0 notification (no id) */
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

/** Pending selection request waiting for renderer response */
interface PendingSelectionRequest {
  resolve: (value: { sessionId: string; text: string } | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * IdeProtocolServer manages the Claude Code IDE protocol connection.
 *
 * Responsibilities:
 * - WebSocket server on 127.0.0.1, random port
 * - Lock file lifecycle at ~/.claude/ide/{port}.lock
 * - Auth via x-claude-code-ide-authorization header
 * - Single-client model (reject additional connections with 409)
 * - JSON-RPC 2.0 request router for 4 tool handlers
 * - Notification sender for selection changes and file opens
 * - Diagnostics cache populated by terminal-bridge error triage
 */
export class IdeProtocolServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private windowManager: WindowManager;
  private port: number = 0;
  private authToken: string = "";
  private lockFilePath: string = "";
  private workspaceFolders: string[] = [];
  private diagnosticsCache: Map<string, IdeDiagnostic> = new Map();
  private pendingSelectionRequests: Map<string, PendingSelectionRequest> = new Map();
  private contextFragments: Array<{ sessionId: string; text: string; addedAt: number }> = [];
  private disposed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private clientAlive = false;

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager;
  }

  /**
   * Start the IDE protocol server.
   * Finds a free port, creates WebSocket server, writes lock file.
   */
  async start(workspaceFolders: string[]): Promise<void> {
    if (this.wss) return;

    this.workspaceFolders = workspaceFolders;
    this.authToken = crypto.randomUUID();

    // Clean up stale lock files from dead processes
    await this.cleanupStaleLockFiles();

    // Find a free port and start WebSocket server
    await this.startWebSocketServer();

    // Write lock file
    this.writeLockFile();

    console.log(`[ide-protocol] Started on port ${this.port}`);
  }

  /**
   * Stop the IDE protocol server.
   */
  stop(): void {
    this.cleanup();
  }

  /**
   * Restart the IDE protocol server with a fresh port and auth token.
   * Cleans up existing connection and lock file, then starts fresh.
   */
  async restart(workspaceFolders: string[]): Promise<void> {
    this.cleanup();
    this.disposed = false;
    await this.start(workspaceFolders);
  }

  /**
   * Update workspace folders and rewrite the lock file (no server restart).
   */
  updateWorkspaceFolders(workspaceFolders: string[]): void {
    this.workspaceFolders = workspaceFolders;
    if (this.wss && this.lockFilePath) {
      this.writeLockFile();
      console.log(`[ide-protocol] Updated workspace folders: ${workspaceFolders.join(", ")}`);
    }
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanup();
  }

  /**
   * Get server status for IPC queries.
   */
  getStatus(): { isRunning: boolean; port: number; hasClient: boolean } {
    return {
      isRunning: this.wss !== null,
      port: this.port,
      hasClient: this.client !== null && this.client.readyState === WebSocket.OPEN,
    };
  }

  /**
   * Update diagnostics cache from terminal-bridge error triage.
   */
  updateDiagnostics(sessionId: string, diagnostic: Omit<IdeDiagnostic, "sessionId">): void {
    this.diagnosticsCache.set(sessionId, { sessionId, ...diagnostic });
  }

  /**
   * Clear diagnostics for a session (e.g., when error auto-dismissed).
   */
  clearDiagnostics(sessionId: string): void {
    this.diagnosticsCache.delete(sessionId);
  }

  /**
   * Add a context fragment (explicit "Add to Chat" action).
   */
  addContextFragment(sessionId: string, text: string): void {
    // Deduplicate: skip if a fragment was added within the last 500ms
    // (guards against double-fire from event races, even with slightly different text)
    const now = Date.now();
    const lastFragment = this.contextFragments[this.contextFragments.length - 1];
    if (lastFragment && now - lastFragment.addedAt < 500) {
      return;
    }
    this.contextFragments.push({ sessionId, text, addedAt: now });
    this.broadcastFragments();
    // Send concatenated text as selection_changed so Claude Code sees it
    this.sendConcatenatedSelection();
  }

  /**
   * Remove a context fragment by index.
   */
  removeContextFragment(index: number): void {
    if (index >= 0 && index < this.contextFragments.length) {
      this.contextFragments.splice(index, 1);
      this.broadcastFragments();
      this.sendConcatenatedSelection();
    }
  }

  /**
   * Clear all context fragments.
   */
  clearContextFragments(): void {
    this.contextFragments = [];
    this.broadcastFragments();
    this.sendConcatenatedSelection();
  }

  /**
   * Broadcast fragment metadata to all renderer windows.
   */
  private broadcastFragments(): void {
    const fragments = this.contextFragments.map((f, i) => ({
      index: i,
      sessionId: f.sessionId,
      preview: f.text.replace(/\s+/g, " ").trim().slice(0, 50),
      lineCount: f.text.split("\n").length,
    }));
    this.windowManager.broadcast("ide:fragmentsChanged", { fragments });
  }

  /**
   * Send concatenated fragment text as a selection_changed notification.
   */
  private sendConcatenatedSelection(): void {
    const concatenated = this.contextFragments.map((f) => f.text).join("\n---\n");
    if (concatenated) {
      const firstSessionId = this.contextFragments[0].sessionId;
      const lines = concatenated.split("\n");
      this.sendNotification("selection_changed", {
        text: concatenated,
        filePath: `terminal://${firstSessionId}`,
        fileUrl: `terminal://${firstSessionId}`,
        selection: {
          start: { line: 0, character: 0 },
          end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 0 },
          isEmpty: false,
        },
      });
    } else {
      this.sendNotification("selection_changed", {
        text: "",
        filePath: "",
        fileUrl: "",
        selection: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          isEmpty: true,
        },
      });
    }
  }

  /**
   * Send file open notification to connected client.
   */
  sendFileOpen(filePath: string): void {
    this.sendNotification("file_opened", {
      uri: `file://${filePath}`,
    });
  }

  /**
   * Handle selection response from renderer (for getSelection tool).
   */
  handleSelectionResponse(requestId: string, sessionId: string, text: string): void {
    const pending = this.pendingSelectionRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingSelectionRequests.delete(requestId);
    pending.resolve({ sessionId, text });
  }

  /**
   * Handle system suspend — no-op for now, but available for future use.
   */
  handleSystemSuspend(): void {
    console.log("[ide-protocol] System suspended");
  }

  /**
   * Handle system resume — no-op for now, but available for future use.
   */
  handleSystemResume(): void {
    console.log("[ide-protocol] System resumed");
  }

  // ==========================================
  // Private methods
  // ==========================================

  /**
   * Find a free port using net.Server on port 0, then start WSS on that port.
   * Retries up to 10 times if WSS bind fails (race condition).
   */
  private async startWebSocketServer(): Promise<void> {
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const port = await this.findFreePort();

      try {
        await this.createWebSocketServer(port);
        this.port = port;
        return;
      } catch (err) {
        console.log(`[ide-protocol] Port ${port} bind failed (attempt ${attempt + 1}), retrying...`);
        if (attempt === maxRetries - 1) {
          throw new Error(`Failed to bind WebSocket server after ${maxRetries} attempts: ${err}`);
        }
      }
    }
  }

  /**
   * Get an OS-assigned free port.
   */
  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          reject(new Error("Failed to get port from server address"));
          return;
        }
        const port = addr.port;
        server.close(() => resolve(port));
      });
      server.on("error", reject);
    });
  }

  /**
   * Create and configure the WebSocket server on the given port.
   */
  private createWebSocketServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: "127.0.0.1",
        port,
        verifyClient: (info, cb) => {
          this.verifyClient(info, cb);
        },
      });

      wss.on("listening", () => {
        this.wss = wss;
        resolve();
      });

      wss.on("error", (err) => {
        if (!this.wss) {
          // Failed to start
          reject(err);
        } else {
          console.error("[ide-protocol] WebSocket server error:", err);
        }
      });

      wss.on("connection", (ws, req) => {
        this.handleConnection(ws, req);
      });
    });
  }

  /**
   * Verify client authorization on WebSocket upgrade.
   */
  private verifyClient(
    info: { req: IncomingMessage },
    cb: (result: boolean, code?: number, message?: string) => void
  ): void {
    const authHeader = info.req.headers["x-claude-code-ide-authorization"];
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (token !== this.authToken) {
      cb(false, 401, "Unauthorized");
      return;
    }

    // Single-client model: close stale connection to allow new one
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      console.log("[ide-protocol] Closing stale client to accept new connection");
      try { this.client.close(1000, "replaced"); } catch { /* ignore */ }
      this.client = null;
    }

    cb(true);
  }

  // ==========================================
  // MCP tool definitions (for tools/list)
  // ==========================================

  private getMcpToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: "openFile",
        description: "Open a file in the editor",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to the file" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "openDiff",
        description: "Open a diff view for a file",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "File path for the diff" },
            oldContent: { type: "string", description: "Original content" },
            newContent: { type: "string", description: "Modified content" },
          },
          required: ["oldContent", "newContent"],
        },
      },
      {
        name: "getOpenEditors",
        description: "Get a list of open editor tabs",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "getDiagnostics",
        description: "Get current diagnostics/errors",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "getWorkspaceFolders",
        description: "Get workspace folders",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "getCurrentSelection",
        description: "Get the currently selected text in the editor",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "getLatestSelection",
        description: "Get the most recently selected text",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "checkDocumentDirty",
        description: "Check if a document has unsaved changes",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Path to the file" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "closeAllDiffTabs",
        description: "Close all open diff tabs",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  // ==========================================
  // WebSocket message handling
  // ==========================================

  /**
   * Handle new WebSocket connection.
   */
  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    console.log("[ide-protocol] Client connected");
    this.client = ws;

    // Start ping/pong heartbeat to detect dead connections
    this.clientAlive = true;
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (!this.clientAlive) {
        console.log("[ide-protocol] Client failed heartbeat, terminating");
        ws.terminate();
        return;
      }
      this.clientAlive = false;
      ws.ping();
    }, 30_000);

    // Push any pending context fragments to the newly connected client
    if (this.contextFragments.length > 0) {
      this.sendConcatenatedSelection();
    }

    ws.on("pong", () => {
      this.clientAlive = true;
    });

    ws.on("message", async (data) => {
      // Any message counts as alive
      this.clientAlive = true;

      try {
        const raw = data.toString();
        const message = JSON.parse(raw) as JsonRpcRequest;
        console.log(`[ide-protocol] ← ${message.method}${message.id != null ? ` (id=${message.id})` : ""}`);

        // Notifications (no id) don't get a response
        if (message.id == null) {
          this.handleNotification(message);
          return;
        }

        const response = await this.handleRequest(message);
        ws.send(JSON.stringify(response));
      } catch (err) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
        ws.send(JSON.stringify(errorResponse));
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`[ide-protocol] Client disconnected (code=${code}, reason=${reason.toString() || "none"})`);
      if (this.client === ws) {
        this.client = null;
        this.stopPingInterval();
        this.windowManager.broadcast("ide:clientDisconnected", { code });
      }
    });

    ws.on("error", (err) => {
      console.error("[ide-protocol] Client error:", err);
      if (this.client === ws) {
        this.client = null;
        this.stopPingInterval();
        this.windowManager.broadcast("ide:clientDisconnected", { code: 1006 });
      }
    });
  }

  /**
   * Stop the ping/pong heartbeat interval.
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Handle JSON-RPC notifications (messages without an id).
   */
  private handleNotification(message: JsonRpcRequest): void {
    switch (message.method) {
      case "notifications/initialized":
        console.log("[ide-protocol] MCP initialized");
        break;
      case "ide_connected":
        console.log("[ide-protocol] Claude Code IDE connected");
        break;
      default:
        console.log(`[ide-protocol] Unhandled notification: ${message.method}`);
        break;
    }
  }

  /**
   * Route a JSON-RPC request to the appropriate handler.
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;

    try {
      let result: unknown;

      switch (method) {
        // MCP lifecycle
        case "initialize":
          result = {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: "brosh",
              version: "1.0.0",
            },
          };
          break;

        case "prompts/list":
          result = { prompts: [] };
          break;

        case "tools/list":
          result = { tools: this.getMcpToolDefinitions() };
          break;

        case "tools/call":
          result = await this.handleToolCall(params);
          break;

        // Legacy direct methods (kept for compatibility)
        case "tools/getDiagnostics":
          result = this.handleGetDiagnostics();
          break;
        case "tools/getOpenEditors":
          result = this.handleGetOpenEditors();
          break;
        case "tools/openDiff":
          result = await this.handleOpenDiff(params);
          break;
        case "tools/openFile":
          result = await this.handleOpenFile(params);
          break;

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }

      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * Handle MCP tools/call — dispatch by tool name.
   */
  private async handleToolCall(
    params?: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    const mcpText = (text: string) => ({ content: [{ type: "text", text }] });

    switch (toolName) {
      case "getDiagnostics": {
        const diagnostics = Array.from(this.diagnosticsCache.values());
        return mcpText(JSON.stringify({ diagnostics }));
      }

      case "getOpenEditors":
        return mcpText(JSON.stringify({ editors: [] }));

      case "getWorkspaceFolders":
        return mcpText(JSON.stringify({ workspaceFolders: this.workspaceFolders }));

      case "openFile": {
        const filePath = args.filePath as string;
        if (typeof filePath !== "string") throw new Error("filePath must be a string");
        this.windowManager.broadcast("ide:openFile", { filePath });
        return mcpText(JSON.stringify({ success: true }));
      }

      case "openDiff": {
        const oldContent = args.oldContent as string;
        const newContent = args.newContent as string;
        const filePath = (args.filePath as string) || "untitled";
        if (typeof oldContent !== "string" || typeof newContent !== "string") {
          throw new Error("oldContent and newContent must be strings");
        }
        this.windowManager.broadcast("ide:openDiff", { oldContent, newContent, filePath });
        return mcpText(JSON.stringify({ success: true }));
      }

      case "getCurrentSelection":
      case "getLatestSelection": {
        const concatenated = this.contextFragments.map((f) => f.text).join("\n---\n");
        if (concatenated) {
          const firstSessionId = this.contextFragments[0].sessionId;
          const lines = concatenated.split("\n");
          return mcpText(JSON.stringify({
            success: true,
            text: concatenated,
            filePath: `terminal://${firstSessionId}`,
            selection: {
              start: { line: 0, character: 0 },
              end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 0 },
            },
          }));
        }
        return mcpText(JSON.stringify({ success: true, text: "", filePath: "", selection: null }));
      }

      case "checkDocumentDirty":
        return mcpText(JSON.stringify({ isDirty: false }));

      case "closeAllDiffTabs":
        return mcpText(JSON.stringify({ success: true }));

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  }

  // ==========================================
  // Legacy direct tool handlers (for backward compat)
  // ==========================================

  /**
   * Handle getDiagnostics tool — return cached diagnostics.
   */
  private handleGetDiagnostics(): { diagnostics: IdeDiagnostic[] } {
    return {
      diagnostics: Array.from(this.diagnosticsCache.values()),
    };
  }

  /**
   * Handle getOpenEditors tool.
   */
  private handleGetOpenEditors(): { editors: Array<{ uri: string }> } {
    return { editors: [] };
  }

  /**
   * Handle openDiff tool — send IPC to renderer to show Monaco diff editor.
   */
  private async handleOpenDiff(
    params?: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    if (!params) throw new Error("Missing params for openDiff");
    const oldContent = params.oldContent as string;
    const newContent = params.newContent as string;
    const filePath = params.filePath as string;
    if (typeof oldContent !== "string" || typeof newContent !== "string") {
      throw new Error("oldContent and newContent must be strings");
    }
    this.windowManager.broadcast("ide:openDiff", {
      oldContent, newContent, filePath: filePath || "untitled",
    });
    return { success: true };
  }

  /**
   * Handle openFile tool — send IPC to renderer to open file in editor.
   */
  private async handleOpenFile(
    params?: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    if (!params) throw new Error("Missing params for openFile");
    const filePath = params.filePath as string;
    if (typeof filePath !== "string") throw new Error("filePath must be a string");
    this.windowManager.broadcast("ide:openFile", { filePath });
    return { success: true };
  }

  /**
   * Send a JSON-RPC notification to the connected client.
   */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return;

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.client.send(JSON.stringify(notification));
  }

  /**
   * Get the lock file directory (~/.claude/ide/).
   */
  private getLockDir(): string {
    return path.join(os.homedir(), ".claude", "ide");
  }

  /**
   * Write lock file to ~/.claude/ide/{port}.lock
   */
  private writeLockFile(): void {
    const lockDir = this.getLockDir();

    // Ensure directory exists
    fs.mkdirSync(lockDir, { recursive: true });

    this.lockFilePath = path.join(lockDir, `${this.port}.lock`);

    const content: LockFileContent = {
      pid: process.pid,
      workspaceFolders: this.workspaceFolders,
      ideName: "brosh",
      transport: "ws",
      runningInWindows: process.platform === "win32",
      authToken: this.authToken,
      port: this.port,
    };

    fs.writeFileSync(this.lockFilePath, JSON.stringify(content, null, 2), {
      mode: 0o600,
    });

    console.log(`[ide-protocol] Lock file written: ${this.lockFilePath}`);
  }

  /**
   * Delete the lock file.
   */
  private deleteLockFile(): void {
    if (!this.lockFilePath) return;

    try {
      fs.unlinkSync(this.lockFilePath);
      console.log(`[ide-protocol] Lock file deleted: ${this.lockFilePath}`);
    } catch {
      // Ignore if already deleted
    }

    this.lockFilePath = "";
  }

  /**
   * Clean up stale lock files from dead processes.
   */
  private async cleanupStaleLockFiles(): Promise<void> {
    const lockDir = this.getLockDir();

    try {
      // Ensure directory exists
      fs.mkdirSync(lockDir, { recursive: true });

      const files = fs.readdirSync(lockDir);
      for (const file of files) {
        if (!file.endsWith(".lock")) continue;

        const filePath = path.join(lockDir, file);
        try {
          const content = JSON.parse(
            fs.readFileSync(filePath, "utf-8")
          ) as LockFileContent;

          // Check if the process is still alive
          if (!this.isProcessAlive(content.pid)) {
            fs.unlinkSync(filePath);
            console.log(`[ide-protocol] Cleaned up stale lock file: ${filePath} (PID ${content.pid} dead)`);
          }
        } catch {
          // Corrupted lock file — remove it
          try {
            fs.unlinkSync(filePath);
            console.log(`[ide-protocol] Cleaned up corrupted lock file: ${filePath}`);
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Lock dir doesn't exist yet, nothing to clean
    }
  }

  /**
   * Check if a process is still alive.
   */
  private isProcessAlive(pid: number): boolean {
    try {
      // Signal 0 doesn't send anything, just checks if process exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up all resources.
   */
  private cleanup(): void {
    // Stop heartbeat
    this.stopPingInterval();

    // Close client connection
    if (this.client) {
      try {
        this.client.close();
      } catch {
        // Ignore
      }
      this.client = null;
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Delete lock file
    this.deleteLockFile();

    // Clear pending requests
    for (const [, pending] of this.pendingSelectionRequests) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pendingSelectionRequests.clear();

    // Clear diagnostics and context fragments
    this.diagnosticsCache.clear();
    this.contextFragments = [];

    this.port = 0;
    this.authToken = "";
  }
}
