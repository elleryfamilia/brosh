/**
 * MCP Server Manager
 *
 * Creates a Unix socket server for MCP clients (AI assistants) to connect to.
 * Tracks connection state, captures client info, and exposes terminal tools.
 * Emits activity events for GUI observability panel.
 *
 * This is an app-scoped singleton - one MCP server shared across all windows.
 * Uses WindowManager to broadcast events to all windows.
 */

import * as fs from "fs";
import { Server as NetServer, Socket } from "net";
import {
  type TrackedClient,
  type ExtendedClientInfo,
  ExtendedClientInfoSchema,
  generateClientId,
  getDefaultSocketPath,
  isSocketInUse,
} from "brosh";
import { SessionLogger } from "brosh";

// Tool handlers from brosh
import {
  getKeySequence,
} from "brosh";

// Import WindowManager type for broadcasting
import type { WindowManager } from "./window-manager.js";

/** JSON-RPC request sent over the socket by MCP clients */
interface SocketRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC response to be sent back to the MCP client */
interface SocketResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

/**
 * MCP activity events broadcast to renderer windows via IPC.
 * These allow the GUI to display real-time information about MCP tool usage.
 */

/** Event emitted when an MCP client initiates a tool call */
export interface McpToolCallStarted {
  id: number;
  tool: string;
  args?: Record<string, unknown>;
  clientId: string;
  timestamp: number;
}

/** Event emitted when a tool call completes (success or error) */
export interface McpToolCallCompleted {
  id: number;
  tool: string;
  success: boolean;
  duration: number;
  timestamp: number;
  clientId: string;
  error?: string;
}

/** Event emitted when an MCP client connects or its info is updated */
export interface McpClientConnected {
  clientId: string;
  clientInfo?: {
    name: string;
    version: string;
  };
  runtime?: {
    hostApp?: string;
    platform?: string;
  };
  timestamp: number;
}

/** Event emitted when an MCP client disconnects */
export interface McpClientDisconnected {
  clientId: string;
  timestamp: number;
}


/**
 * McpServer manages MCP client connections via Unix socket.
 *
 * Responsibilities:
 * - Accept and track client connections
 * - Route tool calls (type, sendKey, getContent, takeScreenshot) to the attached terminal session
 * - Capture extended client info via initialize request
 * - Log activity to session files for debugging/analytics
 * - Broadcast connection and tool call events to renderer windows via IPC
 */
export class McpServer {
  /** Net.Server listening on the socket path */
  private server: NetServer | null = null;
  /** Set of connected client sockets */
  private connectedClients: Set<Socket> = new Set();
  /** Mapping of socket to tracked client info (ID, name, capabilities, etc.) */
  private clientInfoMap: Map<Socket, TrackedClient> = new Map();
  /** Reference to main process WindowManager for broadcasting IPC events */
  private windowManager: WindowManager;
  /** Path to the Unix socket (e.g., /tmp/brosh.sock or \\.\pipe\brosh) */
  private socketPath: string;
  /** ID of the currently attached terminal session, or null if detached */
  private attachedSessionId: string | null = null;
  /** Session logger that writes connection and tool call events to disk */
  private sessionLogger: SessionLogger | null = null;
  /** Interval for watching socket file (detects when another instance takes over) */
  private socketWatchInterval: ReturnType<typeof setInterval> | null = null;
  /** Flag to track if socket was stolen by another instance */
  private socketStolen = false;
  /** Flag to track system suspend state (sleep) - skip watcher during suspend */
  private systemSuspended = false;
  /** Inode of our socket file - if it changes, another instance replaced it */
  private originalInode: bigint | null = null;

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager;
    this.socketPath = getDefaultSocketPath();
    // Note: IPC handlers are now registered globally in index.ts

    // Clean up stale session log files from previous crashes
    SessionLogger.cleanupStale().then((count) => {
      if (count > 0) {
        console.log(`[mcp-server] Cleaned up ${count} stale session log files`);
      }
    });
  }

  /**
   * Find a session by ID across all windows
   */
  private findSession(sessionId: string) {
    for (const managed of this.windowManager.getAllWindows()) {
      const manager = managed.bridge.getManager();
      if (manager) {
        const session = manager.getSessionById(sessionId);
        if (session) {
          return session;
        }
      }
    }
    return null;
  }

  /**
   * Attach MCP to a specific session
   */
  attach(sessionId: string): boolean {
    const session = this.findSession(sessionId);
    if (!session) {
      console.log(`[mcp-server] Cannot attach: session ${sessionId} not found in any window`);
      return false;
    }

    const previousSessionId = this.attachedSessionId;
    this.attachedSessionId = sessionId;
    console.log(`[mcp-server] Attached to session: ${sessionId}`);

    // Notify renderer of attachment change
    this.notifyAttachmentChange(sessionId, previousSessionId);
    return true;
  }

  /**
   * Detach MCP from current session
   */
  detach(): void {
    const previousSessionId = this.attachedSessionId;
    this.attachedSessionId = null;
    console.log("[mcp-server] Detached from session");

    // Notify renderer of attachment change
    this.notifyAttachmentChange(null, previousSessionId);
  }

  /**
   * Get the currently attached session ID
   */
  getAttachedSessionId(): string | null {
    return this.attachedSessionId;
  }

  /**
   * Handle session close - if attached session closes, detach MCP
   */
  handleSessionClose(closedSessionId: string): void {
    if (this.attachedSessionId !== closedSessionId) {
      return;
    }

    console.log(`[mcp-server] Attached session ${closedSessionId} closed, detaching MCP`);
    this.detach();
  }

  // Note: setManager removed - McpServer now searches across all windows via findSession()

  /**
   * Start the MCP socket server
   */
  async start(): Promise<void> {
    if (this.server) return;

    // Reset stolen flag (may be restarting after socket was taken)
    this.socketStolen = false;
    this.originalInode = null;

    // Check if another brosh instance (CLI or another GUI) is using the socket
    const wasInUse = await isSocketInUse(this.socketPath);
    if (wasInUse) {
      console.log("[mcp-server] Taking over socket from another brosh instance");
      // Notify renderer that we're taking over from another instance
      this.windowManager.broadcast("mcp:socketTakeover", {
        socketPath: this.socketPath,
        timestamp: Date.now(),
      });
    }

    // Create session logger
    this.sessionLogger = new SessionLogger();
    console.log(`[mcp-server] Session log: ${this.sessionLogger.getFilePath()}`);

    // Remove existing socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Ignore if doesn't exist
    }

    this.server = new NetServer((socket) => {
      // Disconnect existing clients — only one MCP connection at a time
      for (const existingSocket of this.connectedClients) {
        const client = this.clientInfoMap.get(existingSocket);
        console.log("[mcp-server] Disconnecting previous client (new connection taking over)");
        if (client) {
          this.emitClientDisconnected(client.clientId); // Updates MCP dashboard
        }
        existingSocket.destroy();
      }
      this.connectedClients.clear();
      this.clientInfoMap.clear();

      console.log("[mcp-server] Client connected");
      this.connectedClients.add(socket);

      // Create a placeholder tracked client
      const placeholderClientId = generateClientId();
      const trackedClient: TrackedClient = {
        clientId: placeholderClientId,
        connectedAt: Date.now(),
      };
      this.clientInfoMap.set(socket, trackedClient);

      // Emit client connected event immediately
      this.emitClientConnected(trackedClient);

      // Log connection
      this.sessionLogger?.log({
        type: "connect",
        timestamp: Date.now(),
        clientId: trackedClient.clientId,
      });

      this.notifyConnectionChange();

      let buffer = "";

      /**
       * Handle incoming data from MCP client.
       * Data arrives as newline-delimited JSON-RPC messages.
       * Uses a buffer to handle partial messages split across multiple data events.
       */
      socket.on("data", async (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        // Keep incomplete line in buffer for next data event
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              // Parse JSON-RPC request and handle it
              const request = JSON.parse(line) as SocketRequest;
              const response = await this.handleRequest(request, socket);
              socket.write(JSON.stringify(response) + "\n");
            } catch (error) {
              // Send parse error response
              const errorMessage = error instanceof Error ? error.message : String(error);
              socket.write(
                JSON.stringify({
                  id: 0,
                  error: { message: `Parse error: ${errorMessage}` },
                }) + "\n"
              );
            }
          }
        }
      });

      /** Clean up when client disconnects gracefully */
      socket.on("close", () => {
        console.log("[mcp-server] Client disconnected");
        const client = this.clientInfoMap.get(socket);
        if (client) {
          // Log disconnect event for session audit trail
          this.sessionLogger?.log({
            type: "disconnect",
            timestamp: Date.now(),
            clientId: client.clientId,
          });

          // Notify all renderer windows that a client disconnected
          this.emitClientDisconnected(client.clientId);
        }
        // Clean up references
        this.clientInfoMap.delete(socket);
        this.connectedClients.delete(socket);
        this.notifyConnectionChange();
      });

      /** Clean up on socket error (e.g., unexpected close) */
      socket.on("error", () => {
        const client = this.clientInfoMap.get(socket);
        if (client) {
          this.emitClientDisconnected(client.clientId);
        }
        this.clientInfoMap.delete(socket);
        this.connectedClients.delete(socket);
        this.notifyConnectionChange();
      });
    });

    this.server.listen(this.socketPath, () => {
      console.log(`[mcp-server] Listening on ${this.socketPath}`);

      // Get the inode of our socket file after server starts listening
      try {
        const stats = fs.statSync(this.socketPath, { bigint: true });
        this.originalInode = stats.ino;
      } catch {
        // Couldn't get inode, watcher won't work reliably
        this.originalInode = null;
      }
    });

    this.server.on("error", (error) => {
      console.error("[mcp-server] Server error:", error);
    });

    // Watch for socket file being replaced (another instance taking over)
    // Tracks the inode - if it changes, someone replaced our socket
    // Skips when system is suspended to avoid false positives on wake
    this.socketStolen = false;
    this.socketWatchInterval = setInterval(() => {
      // Skip if already stolen, system is suspended, or no inode to compare
      if (this.socketStolen || this.systemSuspended || this.originalInode === null) return;

      try {
        const stats = fs.statSync(this.socketPath, { bigint: true });
        if (!stats.isSocket() || stats.ino !== this.originalInode) {
          // File was replaced by another instance
          this.handleSocketStolen();
        }
      } catch {
        // Socket file was deleted - another instance took over
        this.handleSocketStolen();
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Handle when another brosh instance takes over the socket
   */
  private handleSocketStolen(): void {
    if (this.socketStolen) return;
    this.socketStolen = true;

    console.log("[mcp-server] Socket was taken over by another brosh instance");

    // Stop the socket watcher
    if (this.socketWatchInterval) {
      clearInterval(this.socketWatchInterval);
      this.socketWatchInterval = null;
    }

    // Disconnect all clients since they're now orphaned
    for (const socket of this.connectedClients) {
      const client = this.clientInfoMap.get(socket);
      if (client) {
        this.emitClientDisconnected(client.clientId);
      }
      socket.destroy();
    }
    this.connectedClients.clear();
    this.clientInfoMap.clear();

    // Close the server (it's orphaned anyway - socket file is gone)
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clear the attached session
    this.attachedSessionId = null;

    // Notify renderer that our socket was stolen
    this.windowManager.broadcast("mcp:socketLost", {
      socketPath: this.socketPath,
      timestamp: Date.now(),
      message: "Another brosh instance (CLI or GUI) took over the MCP socket",
    });

    this.notifyConnectionChange();
  }

  /**
   * Handle system suspend (sleep) - pause socket watcher
   * Called by WindowManager when system enters sleep mode
   */
  handleSystemSuspend(): void {
    this.systemSuspended = true;
    console.log("[mcp-server] System suspended - pausing socket watcher");
  }

  /**
   * Handle system resume (wake) - resume socket watcher
   * Called by WindowManager when system wakes from sleep
   */
  handleSystemResume(): void {
    this.systemSuspended = false;
    console.log("[mcp-server] System resumed - resuming socket watcher");
  }

  /**
   * Stop the MCP socket server
   */
  stop(): void {
    // Stop socket watcher
    if (this.socketWatchInterval) {
      clearInterval(this.socketWatchInterval);
      this.socketWatchInterval = null;
    }

    if (this.server) {
      // Close all client connections
      for (const client of this.connectedClients) {
        client.destroy();
      }
      this.connectedClients.clear();
      this.clientInfoMap.clear();

      this.server.close();
      this.server = null;

      // Close session logger
      if (this.sessionLogger) {
        this.sessionLogger.close();
        this.sessionLogger = null;
      }

      // Remove socket file
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Ignore
      }

      this.notifyConnectionChange();
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { isRunning: boolean; clientCount: number; socketPath: string } {
    return {
      isRunning: this.server !== null,
      clientCount: this.connectedClients.size,
      socketPath: this.socketPath,
    };
  }

  // Note: IPC handlers are now registered globally in index.ts

  /**
   * Disconnect a specific client by clientId
   */
  disconnectClient(clientId: string): boolean {
    for (const [socket, client] of this.clientInfoMap) {
      if (client.clientId === clientId) {
        console.log(`[mcp-server] Disconnecting client: ${clientId}`);
        socket.destroy();
        return true;
      }
    }
    console.log(`[mcp-server] Client not found: ${clientId}`);
    return false;
  }

  /**
   * Notify all windows of connection changes
   */
  private notifyConnectionChange(): void {
    this.windowManager.broadcast("mcp:statusChanged", this.getStatus());
  }

  /**
   * Notify all windows of attachment changes
   */
  private notifyAttachmentChange(
    newSessionId: string | null,
    previousSessionId: string | null
  ): void {
    this.windowManager.broadcast("mcp:attachmentChanged", {
      attachedSessionId: newSessionId,
      previousSessionId,
    });
  }

  /**
   * Handle a JSON-RPC request from an MCP client.
   * Routes to handleInitialize for the initialize method, or to tool handlers for other methods.
   * All tool calls require an attached terminal session.
   */
  private async handleRequest(request: SocketRequest, socket: Socket): Promise<SocketResponse> {
    const { id, method, params } = request;
    const startTime = Date.now();

    // Get or create tracked client for this socket (updated on initialize)
    let trackedClient = this.clientInfoMap.get(socket);
    if (!trackedClient) {
      trackedClient = {
        clientId: generateClientId(),
        connectedAt: Date.now(),
      };
      this.clientInfoMap.set(socket, trackedClient);
    }

    // Special handling for initialize method - captures client name, version, capabilities
    if (method === "initialize") {
      return this.handleInitialize(request, socket, trackedClient);
    }

    // All other methods (type, sendKey, getContent, takeScreenshot) require an attached session
    if (!this.attachedSessionId) {
      return { id, error: { message: "No terminal attached. Enable MCP on a terminal tab first." } };
    }

    // Look up the session across all windows
    const session = this.findSession(this.attachedSessionId);
    if (!session) {
      return { id, error: { message: `Attached session ${this.attachedSessionId} not found` } };
    }

    // Record tool call start time and emit event for observability
    this.emitToolCallStarted(id, method, params, trackedClient.clientId);

    try {
      let result: unknown;

      switch (method) {
        case "type": {
          const text = params?.text as string;
          if (!text) {
            const error = "Missing 'text' parameter";
            this.emitToolCallCompleted(id, method, false, Date.now() - startTime, error, trackedClient.clientId);
            return { id, error: { message: error } };
          }
          session.write(text);
          result = { content: [{ type: "text", text: `Typed: ${text}` }] };
          break;
        }

        case "sendKey": {
          const key = params?.key as string;
          if (!key) {
            const error = "Missing 'key' parameter";
            this.emitToolCallCompleted(id, method, false, Date.now() - startTime, error, trackedClient.clientId);
            return { id, error: { message: error } };
          }
          const sequence = getKeySequence(key);
          if (!sequence) {
            const error = `Unknown key: ${key}`;
            this.emitToolCallCompleted(id, method, false, Date.now() - startTime, error, trackedClient.clientId);
            return { id, error: { message: error } };
          }
          session.write(sequence);
          result = { content: [{ type: "text", text: `Sent key: ${key}` }] };
          break;
        }

        case "getContent": {
          const content = session.getContent();
          result = { content: [{ type: "text", text: content }] };
          break;
        }

        case "takeScreenshot": {
          const screenshot = session.takeScreenshot();
          result = {
            content: [
              {
                type: "text",
                text: JSON.stringify(screenshot, null, 2),
              },
            ],
          };
          break;
        }

        default: {
          const error = `Unknown method: ${method}`;
          this.emitToolCallCompleted(id, method, false, Date.now() - startTime, error, trackedClient.clientId);
          return { id, error: { message: error } };
        }
      }

      // Emit tool call completed event
      this.emitToolCallCompleted(id, method, true, Date.now() - startTime, undefined, trackedClient.clientId);

      return { id, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitToolCallCompleted(id, method, false, Date.now() - startTime, message, trackedClient.clientId);
      return { id, error: { message } };
    }
  }

  /**
   * Handle MCP initialize request - captures extended client info
   */
  private handleInitialize(
    request: SocketRequest,
    socket: Socket,
    trackedClient: TrackedClient
  ): SocketResponse {
    const { id, params } = request;
    console.log("[mcp-server] handleInitialize called with params:", JSON.stringify(params));

    try {
      // Parse extended client info from params
      const parsed = ExtendedClientInfoSchema.safeParse(params);
      const extendedInfo: ExtendedClientInfo = parsed.success ? parsed.data : {};

      // Update tracked client with parsed info
      if (extendedInfo.clientInfo) {
        trackedClient.clientId = generateClientId(extendedInfo.clientInfo);
        trackedClient.clientInfo = extendedInfo.clientInfo;
      }
      trackedClient.runtime = extendedInfo.runtime;
      trackedClient.capabilities = extendedInfo.capabilities;
      trackedClient.session = extendedInfo.session;
      trackedClient.observability = extendedInfo.observability;

      // Update the map
      this.clientInfoMap.set(socket, trackedClient);

      // Log the extended info (connection was already logged on socket connect)
      this.sessionLogger?.log({
        type: "connect",
        timestamp: Date.now(),
        clientId: trackedClient.clientId,
        clientName: trackedClient.clientInfo?.name,
        version: trackedClient.clientInfo?.version,
        runtime: trackedClient.runtime,
      });

      // Emit updated client info (client was already connected, this updates the info)
      // Re-emit so the renderer gets the updated client details
      this.emitClientConnected(trackedClient);

      console.log(
        `[mcp-server] Client initialized: ${trackedClient.clientInfo?.name || "unknown"} v${trackedClient.clientInfo?.version || "?"}`
      );

      // Return standard MCP initialize response
      return {
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "brosh",
            version: "1.0.0",
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { id, error: { message: `Initialize failed: ${message}` } };
    }
  }

  /**
   * Emit tool call started event to all windows
   */
  private emitToolCallStarted(
    id: number,
    tool: string,
    args: Record<string, unknown> | undefined,
    clientId: string
  ): void {
    const event: McpToolCallStarted = {
      id,
      tool,
      args,
      clientId,
      timestamp: Date.now(),
    };

    this.windowManager.broadcast("mcp:toolCallStarted", event);
  }

  /**
   * Emit tool call completed event to all windows
   */
  private emitToolCallCompleted(
    id: number,
    tool: string,
    success: boolean,
    duration: number,
    error: string | undefined,
    clientId: string
  ): void {
    const event: McpToolCallCompleted = {
      id,
      tool,
      success,
      duration,
      timestamp: Date.now(),
      clientId,
      error,
    };

    this.windowManager.broadcast("mcp:toolCallCompleted", event);

    // Also log to session file
    this.sessionLogger?.log({
      type: "tool_call",
      timestamp: Date.now(),
      clientId,
      method: tool,
      durationMs: duration,
      result: success ? "success" : "error",
      error,
    });
  }

  /**
   * Emit client connected event to all windows
   */
  private emitClientConnected(client: TrackedClient): void {
    console.log("[mcp-server] emitClientConnected called for:", client.clientId);

    const event: McpClientConnected = {
      clientId: client.clientId,
      clientInfo: client.clientInfo,
      runtime: client.runtime,
      timestamp: Date.now(),
    };

    console.log("[mcp-server] Broadcasting mcp:clientConnected event:", event);
    this.windowManager.broadcast("mcp:clientConnected", event);
  }

  /**
   * Emit client disconnected event to all windows
   */
  private emitClientDisconnected(clientId: string): void {
    const event: McpClientDisconnected = {
      clientId,
      timestamp: Date.now(),
    };

    this.windowManager.broadcast("mcp:clientDisconnected", event);
  }

  /**
   * Get currently connected clients info
   */
  getConnectedClients(): TrackedClient[] {
    const clients = Array.from(this.clientInfoMap.values());
    console.log("[mcp-server] getConnectedClients called, returning:", clients.length, "clients");
    return clients;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    // Note: IPC handlers are registered globally in index.ts
  }
}
