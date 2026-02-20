/**
 * Main Application Component
 *
 * Root component that manages the terminal layout with a single pane tree per window.
 * Supports split panes. Shows mode selection dialog for new terminals,
 * inline selector for split panes.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { TitleBar } from "./components/TitleBar";
import { McpConflictDialog } from "./components/McpConflictDialog";
import { McpDisconnectDialog } from "./components/McpDisconnectDialog";
import { McpInstructionsModal } from "./components/McpInstructionsModal";
import { SandboxSettingsTooltip } from "./components/SandboxSettingsTooltip";
import { WelcomeModal } from "./components/WelcomeModal";
import { ModeSelectionModal } from "./components/ModeSelectionModal";
import { PaneContainer } from "./components/PaneContainer";
import { ClaudePanel } from "./components/ClaudePanel";
import { SmartStatusBar } from "./components/smart-status-bar";
import { ToastContainer } from "./components/ToastContainer";
import type { ToastData } from "./components/Toast";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuGroup } from "./components/ContextMenu";
import type { TerminalMethods } from "./components/Terminal";
import { FindBar } from "./components/FindBar";
import { SettingsPanel, useSettings } from "./settings";
import type { SandboxConfig } from "./types/sandbox";
import type { Pane, SplitDirection, PaneSandboxConfig, DiffSource } from "./types/pane";
import {
  SidebarHost,
  useWorkspaceContext,
  usePluginShortcuts,
  getPlugin,
} from "./plugins";
import { useGitData } from "./plugins/git/useGitData";
import { isTerminalPane, isPendingPane } from "./types/pane";
import {
  createTerminalPane,
  createPendingPane,
  splitPane as splitPaneInTree,
  removePaneFromTree,
  updateSplitRatio,
  getAllTerminalPanes,
  findAdjacentPane,
  updateTerminalProcessName,
  updateWindowTitle,
  getFirstTerminalPane,
  findPaneById,
  getAdjacentTerminalPane,
  replacePaneInTree,
  hasPendingPanes,
} from "./utils/paneTree";
import { EditorPane } from "./components/EditorPane";
import { trackTerminalCreated, trackMcpAttachment } from "./utils/analytics";
import type { NavigationDirection } from "./utils/paneTree";
import type { ErrorNotification } from "./components/ErrorNotificationBar";

// AI CLI processes that trigger TUI timeline snapshots
const AI_CLI_PROCESSES = new Set(['claude']);
// Claude CLI spawns a versioned worker binary (e.g., "2.1.32") as the PTY
// foreground process. Match semver-like names so the debounced process check
// doesn't miss the session when the brief `claude` launcher is skipped.
const CLAUDE_WORKER_RE = /^\d+\.\d+\.\d+/;
const SHELL_PROCESSES = new Set([
  'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh',
  '-bash', '-zsh', '-fish', '-sh',
]);

// Conflict dialog state
interface ConflictDialogState {
  isOpen: boolean;
  targetSessionId: string | null;
}

// Detect macOS for title bar styling
const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

// Check if this is the first window (for logo display)
// This is passed via URL query param from the main process
const isFirstAppWindow = new URLSearchParams(window.location.search).get("isFirstWindow") === "true";

// Calculate terminal dimensions based on window size
function calculateTerminalSize() {
  const charWidth = 9;
  const lineHeight = 17;
  const titleBarHeight = isMac ? 42 : 0;
  const statusBarHeight = 43; // SmartStatusBar is 43px
  const paneHeaderHeight = 28;

  const availableHeight =
    window.innerHeight - titleBarHeight - statusBarHeight - paneHeaderHeight;

  return {
    cols: Math.floor(window.innerWidth / charWidth),
    rows: Math.floor(availableHeight / lineHeight),
  };
}


export function App() {
  const [rootPane, setRootPane] = useState<Pane | null>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Welcome modal state (first-launch only)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeCheckComplete, setWelcomeCheckComplete] = useState(false);

  // Mode selection modal state
  const [showModeModal, setShowModeModal] = useState(false);

  // Track if this is the initial terminal creation in this window (for logo display)
  // Logo only shows on first terminal of first window
  const hasCreatedFirstTerminal = useRef(false);

  // Track which mode was selected for reuse on new terminals
  const pendingTabModeRef = useRef<"direct" | "sandbox">("direct");
  // Track the last sandbox config so it can be reused when skipping the modal
  const pendingTabConfigRef = useRef<SandboxConfig | undefined>(undefined);

  // Keep refs to current state for use in callbacks without stale closures
  const rootPaneRef = useRef<Pane | null>(null);
  rootPaneRef.current = rootPane;
  const focusedPaneIdRef = useRef<string | null>(null);
  focusedPaneIdRef.current = focusedPaneId;

  // MCP attachment state
  const [mcpAttachedSessionId, setMcpAttachedSessionId] = useState<
    string | null
  >(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({
    isOpen: false,
    targetSessionId: null,
  });

  // MCP disconnect confirmation dialog
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // MCP instructions modal state
  const [showMcpInstructions, setShowMcpInstructions] = useState(false);

  // Sandbox settings tooltip
  const [sandboxTooltipConfig, setSandboxTooltipConfig] = useState<PaneSandboxConfig | null>(null);

  // Note: MCP dashboard expand state removed - SmartStatusBar uses modals instead

  // Settings panel state
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  // Sidebar plugin state
  const [activeSidebarPlugin, setActiveSidebarPlugin] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(0);

  // Editor panel state (extracted from pane tree)
  const [editorFile, setEditorFile] = useState<{
    filePath: string;
    isDiff: boolean;
    diffSource: DiffSource;
  } | null>(null);

  const [showDiffBanner, setShowDiffBanner] = useState(false);
  const diffBannerRememberRef = useRef(false);


  // Toast notification state
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const toastIdCounter = useRef(0);

  // Claude panel state
  const [showClaudePanel, setShowClaudePanel] = useState(false);
  const [claudePanelSessionId, setClaudePanelSessionId] = useState<string | null>(null);
  const [claudePanelWidth, setClaudePanelWidth] = useState(() => {
    const stored = localStorage.getItem('claudePanelWidth');
    return stored ? Math.max(300, Math.min(800, parseInt(stored, 10) || 400)) : 400;
  });

  // Claude session IDs per terminal (maps terminal session ID to Claude session ID)
  const [claudeSessionIds, setClaudeSessionIds] = useState<Map<string, string>>(new Map());

  // Error notification state (maps session ID to notification)
  const [errorNotifications, setErrorNotifications] = useState<Map<string, ErrorNotification>>(new Map());

  const { settings, updateSettings: updateAppSettings } = useSettings();

  // Focused terminal CWD and home directory (for Claude button visibility)
  const [focusedCwd, setFocusedCwd] = useState<string | null>(null);
  const homedirRef = useRef<string | null>(null);

  // AI TUI detection refs (kept for analytics and feature toggling)
  const aiTuiActiveSessionsRef = useRef<Set<string>>(new Set());
  const sessionProcessRef = useRef<Map<string, string>>(new Map());

  // Context menu state
  interface ContextMenuState {
    isOpen: boolean;
    position: { x: number; y: number };
    sessionId: string | null;
    terminalMethods: TerminalMethods | null;
  }
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    sessionId: null,
    terminalMethods: null,
  });

  // Find bar state
  const [showFindBar, setShowFindBar] = useState(false);
  const findBarTerminalMethodsRef = useRef<TerminalMethods | null>(null);
  const showFindBarRef = useRef(showFindBar);
  showFindBarRef.current = showFindBar;

  // Close find bar and clear search highlights
  const closeFindBar = useCallback(() => {
    setShowFindBar(false);
    findBarTerminalMethodsRef.current?.clearSearch();
  }, []);


  // Get focused session ID from refs (for use in callbacks without stale closures)
  const getFocusedSessionId = useCallback((): string | null => {
    const rp = rootPaneRef.current;
    const fpId = focusedPaneIdRef.current;
    if (!rp || !fpId) return null;
    const pane = findPaneById(rp, fpId);
    return pane && isTerminalPane(pane) ? pane.sessionId : null;
  }, []);

  // Compute focused session ID for dependency tracking
  const currentFocusedSessionId = (() => {
    if (!rootPane || !focusedPaneId) return null;
    const pane = findPaneById(rootPane, focusedPaneId);
    return pane && isTerminalPane(pane) ? pane.sessionId : null;
  })();

  // Git data (fetching + polling + watchers)
  const { gitStatus, gitCommits, projectRoot } = useGitData({
    getFocusedSessionId,
    isActive: activeSidebarPlugin === 'git',
    focusedSessionId: currentFocusedSessionId,
  });

  // Workspace context (aggregates existing state for plugin system)
  const workspace = useWorkspaceContext({
    gitStatus,
    gitCommits,
    projectRoot,
    focusedSessionId: currentFocusedSessionId,
    cwd: focusedCwd,
  });

  // Plugin toggle handler
  const togglePlugin = useCallback((pluginId: string) => {
    setActiveSidebarPlugin((prev) => {
      if (prev === pluginId) {
        setEditorFile(null); // Close editor when closing sidebar
        return null;
      }
      return pluginId;
    });
  }, []);

  // Plugin keyboard shortcuts
  const handlePluginShortcut = usePluginShortcuts({
    workspace,
    onTogglePlugin: togglePlugin,
  });

  // Open settings panel
  const openSettings = useCallback(() => {
    setShowSettingsPanel(true);
  }, []);

  // Close settings panel
  const closeSettings = useCallback(() => {
    setShowSettingsPanel(false);
  }, []);

  // Add a toast notification
  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = `toast-${++toastIdCounter.current}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  // Remove a toast notification
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Create a new terminal session with specified mode
  const createTerminalSession = useCallback(
    async (mode: "direct" | "sandbox", config?: SandboxConfig) => {
      if (mode === "sandbox" && config) {
        try {
          await window.terminalAPI.setSandboxMode(config);
        } catch (err) {
          console.error("Failed to set sandbox mode:", err);
          throw err;
        }
      }

      const size = calculateTerminalSize();
      // Backend defaults to home directory when no cwd specified
      const result = await window.terminalAPI.createSession({
        cols: size.cols,
        rows: size.rows,
      });

      if (!result.success || !result.sessionId) {
        throw new Error(result.error || "Failed to create session");
      }

      // Use "shell" as default — the real process name arrives via the
      // process-changed event within ~100ms and updates the pane header.
      return {
        sessionId: result.sessionId,
        processName: "shell",
        isSandboxed: mode === "sandbox",
        sandboxConfig: mode === "sandbox" ? config : undefined,
      };
    },
    []
  );

  // Create the initial pane for the window
  const createInitialPane = useCallback(
    async (mode: "direct" | "sandbox", config?: SandboxConfig) => {
      try {
        const { sessionId, processName, isSandboxed, sandboxConfig } = await createTerminalSession(
          mode,
          config
        );
        const pane = createTerminalPane(sessionId, processName, isSandboxed, sandboxConfig);

        setRootPane(pane);
        setFocusedPaneId(pane.id);
      } catch (err) {
        console.error("Failed to create terminal:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create terminal"
        );
      }
    },
    [createTerminalSession]
  );

  // Handle mode selection from modal
  const handleModeSelected = useCallback(
    async (mode: "direct" | "sandbox", config?: SandboxConfig) => {
      hasCreatedFirstTerminal.current = true;
      setShowModeModal(false);
      pendingTabModeRef.current = mode;
      pendingTabConfigRef.current = config;
      await createInitialPane(mode, config);
      trackTerminalCreated(mode, false);
    },
    [createInitialPane]
  );

  // Split the focused pane immediately with a pending pane (or skip modal if setting is off)
  const splitFocusedPane = useCallback(
    (direction: SplitDirection) => {
      const rp = rootPaneRef.current;
      const fpId = focusedPaneIdRef.current;
      if (!rp || !fpId) return;

      // Don't allow split if there's already a pending pane
      if (hasPendingPanes(rp)) return;

      // Skip the pending pane and create terminal directly if setting is off
      if (hasCreatedFirstTerminal.current && !settings.terminal.askModeForNewTerminals) {
        createTerminalSession(pendingTabModeRef.current, pendingTabConfigRef.current)
          .then(({ sessionId, processName, isSandboxed, sandboxConfig }) => {
            const terminalPane = createTerminalPane(sessionId, processName, isSandboxed, sandboxConfig);
            setRootPane((prev) => {
              if (!prev) return prev;
              return splitPaneInTree(prev, focusedPaneIdRef.current!, direction, terminalPane);
            });
            setFocusedPaneId(terminalPane.id);
            trackTerminalCreated(pendingTabModeRef.current, true);
          })
          .catch((err) => {
            console.error("Failed to create terminal for split:", err);
          });
        return;
      }

      const pendingPane = createPendingPane();
      const newRoot = splitPaneInTree(rp, fpId, direction, pendingPane);
      setRootPane(newRoot);
      setFocusedPaneId(pendingPane.id);
    },
    [settings.terminal.askModeForNewTerminals, createTerminalSession]
  );

  // Handle mode selection from inline pending pane
  const handlePendingModeSelected = useCallback(
    async (
      paneId: string,
      mode: "direct" | "sandbox",
      config?: SandboxConfig
    ) => {
      const rp = rootPaneRef.current;
      if (!rp) return;

      // Store mode and config so subsequent terminals can reuse them
      pendingTabModeRef.current = mode;
      pendingTabConfigRef.current = config;

      try {
        const { sessionId, processName, isSandboxed, sandboxConfig } = await createTerminalSession(
          mode,
          config
        );
        const terminalPane = createTerminalPane(sessionId, processName, isSandboxed, sandboxConfig);
        // Preserve the pane ID so focus works correctly
        terminalPane.id = paneId;

        setRootPane((prev) => prev ? replacePaneInTree(prev, paneId, terminalPane) : prev);
        setFocusedPaneId(paneId);

        trackTerminalCreated(mode, true);
      } catch (err) {
        console.error("Failed to create terminal in pane:", err);
        setRootPane((prev) => {
          if (!prev) return prev;
          return removePaneFromTree(prev, paneId) ?? prev;
        });
      }
    },
    [createTerminalSession]
  );

  // Handle cancellation of pending pane (escape key)
  const handlePendingCancel = useCallback(
    (paneId: string) => {
      const rp = rootPaneRef.current;
      if (!rp) return;

      const newRoot = removePaneFromTree(rp, paneId);
      if (newRoot) {
        const terminalToFocus = getFirstTerminalPane(newRoot);
        setRootPane(newRoot);
        if (terminalToFocus) setFocusedPaneId(terminalToFocus.id);
      }
    },
    []
  );

  // Handle session close (from terminal exit)
  const handleSessionClose = useCallback(
    (sessionId: string) => {
      // Clean up AI TUI tracking and Claude session association
      aiTuiActiveSessionsRef.current.delete(sessionId);
      sessionProcessRef.current.delete(sessionId);
      setClaudeSessionIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });

      // If the closed session was the Claude panel session, clear it
      setClaudePanelSessionId((prev) => (prev === sessionId ? null : prev));

      const rp = rootPaneRef.current;
      if (!rp) return;

      const terminals = getAllTerminalPanes(rp);
      const terminal = terminals.find((t) => t.sessionId === sessionId);
      if (!terminal) return;

      if (terminals.length === 1) {
        // Last terminal — close the window
        window.close();
      } else {
        const newRoot = removePaneFromTree(rp, terminal.id);
        if (newRoot) {
          setRootPane(newRoot);
          setFocusedPaneId((prev) => {
            if (prev === terminal.id) {
              return getFirstTerminalPane(newRoot)?.id ?? prev;
            }
            return prev;
          });
        }
      }
    },
    []
  );

  // Close the focused pane (Cmd+W)
  const closeFocusedPane = useCallback(() => {
    const rp = rootPaneRef.current;
    const fpId = focusedPaneIdRef.current;
    if (!rp || !fpId) return;

    const focusedPane = findPaneById(rp, fpId);
    if (!focusedPane) return;

    // Handle closing a pending pane (cancel the split)
    if (isPendingPane(focusedPane)) {
      const newRoot = removePaneFromTree(rp, focusedPane.id);
      if (newRoot) {
        const newFocused = getFirstTerminalPane(newRoot);
        setRootPane(newRoot);
        if (newFocused) setFocusedPaneId(newFocused.id);
      }
      return;
    }

    if (!isTerminalPane(focusedPane)) return;

    const terminals = getAllTerminalPanes(rp);
    if (terminals.length === 1) {
      // Last terminal — close session and window
      window.terminalAPI.closeSession(focusedPane.sessionId).catch(console.error);
      window.close();
    } else {
      window.terminalAPI.closeSession(focusedPane.sessionId).catch(console.error);

      const newRoot = removePaneFromTree(rp, focusedPane.id);
      if (newRoot) {
        const newFocused = getFirstTerminalPane(newRoot);
        setRootPane(newRoot);
        if (newFocused) setFocusedPaneId(newFocused.id);
      }
    }
  }, []);

  // Navigate focus between panes (directional)
  const navigateFocus = useCallback(
    (direction: NavigationDirection) => {
      const rp = rootPaneRef.current;
      const fpId = focusedPaneIdRef.current;
      if (!rp || !fpId) return;

      const adjacentPaneId = findAdjacentPane(rp, fpId, direction);
      if (adjacentPaneId) {
        setFocusedPaneId(adjacentPaneId);
      }
    },
    []
  );

  // Cycle focus between panes (Cmd+] / Cmd+[)
  const cycleFocus = useCallback(
    (direction: "next" | "prev") => {
      const rp = rootPaneRef.current;
      const fpId = focusedPaneIdRef.current;
      if (!rp || !fpId) return;

      const nextPane = getAdjacentTerminalPane(rp, fpId, direction);
      if (nextPane) {
        setFocusedPaneId(nextPane.id);
      }
    },
    []
  );

  // Set focused pane (from click)
  const setFocusedPane = useCallback((paneId: string) => {
    setFocusedPaneId(paneId);

    // Close find bar when terminal is clicked/focused
    if (showFindBarRef.current) {
      setShowFindBar(false);
      findBarTerminalMethodsRef.current?.clearSearch();
    }
  }, []);

  // Update split ratio
  const handleSplitRatioChange = useCallback(
    (splitPaneId: string, newRatio: number) => {
      setRootPane((prev) => prev ? updateSplitRatio(prev, splitPaneId, newRatio) : prev);
    },
    []
  );

  // Handle MCP toggle from pane header
  const handleMcpToggle = useCallback(
    (sessionId: string) => {
      const currentSessionHasMcp = sessionId === mcpAttachedSessionId;

      if (currentSessionHasMcp) {
        // Show disconnect confirmation dialog
        setShowDisconnectDialog(true);
      } else if (mcpAttachedSessionId) {
        // Another session has MCP - show conflict dialog
        setConflictDialog({
          isOpen: true,
          targetSessionId: sessionId,
        });
      } else {
        // No MCP attached anywhere - attach directly
        window.terminalAPI.mcpAttach(sessionId).catch(console.error);
      }
    },
    [mcpAttachedSessionId]
  );

  // Handle disconnect dialog confirm
  const handleDisconnectConfirm = useCallback(() => {
    window.terminalAPI.mcpDetach().catch(console.error);
    setShowDisconnectDialog(false);
  }, []);

  // Handle disconnect dialog cancel
  const handleDisconnectCancel = useCallback(() => {
    setShowDisconnectDialog(false);
  }, []);

  // Handle sandbox badge click - show settings tooltip
  const handleSandboxClick = useCallback((config: PaneSandboxConfig) => {
    setSandboxTooltipConfig(config);
  }, []);

  // Handle sandbox tooltip close
  const handleSandboxTooltipClose = useCallback(() => {
    setSandboxTooltipConfig(null);
  }, []);

  // Handle conflict dialog confirm
  const handleConflictConfirm = useCallback(() => {
    if (conflictDialog.targetSessionId) {
      window.terminalAPI
        .mcpAttach(conflictDialog.targetSessionId)
        .catch(console.error);
    }
    setConflictDialog({
      isOpen: false,
      targetSessionId: null,
    });
  }, [conflictDialog.targetSessionId]);

  // Handle conflict dialog cancel
  const handleConflictCancel = useCallback(() => {
    setConflictDialog({
      isOpen: false,
      targetSessionId: null,
    });
  }, []);

  // Handle Claude panel toggle
  const handleClaudeToggle = useCallback(() => {
    setShowClaudePanel((prev) => !prev);
  }, []);

  // Handle "Add to Chat" — paste selected text into the Claude panel terminal
  const handleAddToChat = useCallback((sessionId: string, text: string) => {
    if (!claudePanelSessionId) return;
    window.terminalAPI.input(claudePanelSessionId, text);
  }, [claudePanelSessionId]);

  // Get the CWD for the Claude panel (from focused terminal, falling back to git root)
  const getClaudePanelCwd = useCallback(async (): Promise<string | undefined> => {
    // Try the live CWD from the focused terminal
    const sessionId = getFocusedSessionId();
    if (sessionId) {
      try {
        const result = await window.terminalAPI.getCwd(sessionId);
        if (result.success && result.cwd) return result.cwd;
      } catch {
        // Fall through
      }
    }
    // Fall back to git root, then undefined
    return projectRoot ?? undefined;
  }, [getFocusedSessionId, projectRoot]);

  // Handle Claude panel resize
  const handleClaudePanelResize = useCallback((width: number) => {
    const clamped = Math.max(300, Math.min(800, width));
    setClaudePanelWidth(clamped);
    localStorage.setItem('claudePanelWidth', String(clamped));
  }, []);

  // Handle context menu open
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, methods: TerminalMethods, sessionId: string) => {
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        sessionId,
        terminalMethods: methods,
      });
    },
    []
  );

  // Handle terminal methods ready (for find bar)
  const handleTerminalMethodsReady = useCallback(
    (paneId: string, methods: TerminalMethods | null) => {
      if (paneId === focusedPaneIdRef.current && methods) {
        findBarTerminalMethodsRef.current = methods;
      }
    },
    []
  );

  // Handle file link click from terminal
  const handleFileLink = useCallback(
    async (filePath: string, isDiff: boolean) => {
      const rp = rootPaneRef.current;
      const fpId = focusedPaneIdRef.current;
      if (!rp || !fpId) return;

      // Resolve relative paths using the terminal's cwd
      let resolvedPath = filePath;
      if (!filePath.startsWith("/")) {
        const focusedPane = findPaneById(rp, fpId);
        if (focusedPane && isTerminalPane(focusedPane)) {
          try {
            const cwdResult = await window.terminalAPI.getCwd(focusedPane.sessionId);
            if (cwdResult.success && cwdResult.cwd) {
              if (filePath.startsWith("./")) {
                resolvedPath = `${cwdResult.cwd}/${filePath.slice(2)}`;
              } else {
                resolvedPath = `${cwdResult.cwd}/${filePath}`;
              }
            }
          } catch {
            // Fall back to original path
          }
        }
      }

      // Open sidebar + editor panel
      setActiveSidebarPlugin('git');
      setEditorFile({ filePath: resolvedPath, isDiff, diffSource: "git-head" });
    },
    []
  );

  // Handle editor file open (from sidebar plugins)
  const handleOpenEditorFile = useCallback(
    (filePath: string, isDiff = false, diffSource: DiffSource = 'git-head') => {
      setEditorFile({ filePath, isDiff, diffSource });
    },
    []
  );

  // Handle editor panel close
  const handleEditorClose = useCallback(() => {
    setEditorFile(null);
  }, []);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Create new window
  const createNewWindow = useCallback(async () => {
    try {
      await window.terminalAPI.createWindow();
    } catch (err) {
      console.error("Failed to create new window:", err);
    }
  }, []);

  // Build context menu groups
  const buildContextMenuGroups = useCallback((): ContextMenuGroup[] => {
    const hasMultiplePanes = rootPane && !isTerminalPane(rootPane);
    const hasMcp = contextMenu.sessionId === mcpAttachedSessionId;
    const hasSelection = contextMenu.terminalMethods?.hasSelection() ?? false;

    return [
      // Clipboard group
      {
        id: "clipboard",
        items: [
          {
            id: "copy",
            label: "Copy",
            shortcut: isMac ? "\u2318C" : "Ctrl+C",
            enabled: hasSelection,
            onClick: () => contextMenu.terminalMethods?.copy(),
          },
          {
            id: "addToChat",
            label: "Add to Chat",
            shortcut: isMac ? "\u21E7\u2318L" : "Ctrl+Shift+L",
            enabled: hasSelection,
            onClick: () => {
              const text = contextMenu.terminalMethods?.getSelection();
              if (text && contextMenu.sessionId) {
                handleAddToChat(contextMenu.sessionId, text);
                addToast({ message: "Added to context", variant: "info", duration: 2000 });
              }
            },
          },
          {
            id: "paste",
            label: "Paste",
            shortcut: isMac ? "\u2318V" : "Ctrl+V",
            onClick: () => contextMenu.terminalMethods?.paste(),
          },
          {
            id: "selectAll",
            label: "Select All",
            shortcut: isMac ? "\u2318A" : "Ctrl+A",
            onClick: () => contextMenu.terminalMethods?.selectAll(),
          },
          {
            id: "clear",
            label: "Clear",
            shortcut: isMac ? "\u2318K" : "Ctrl+K",
            onClick: () => contextMenu.terminalMethods?.clear(),
          },
        ],
      },
      // Pane group
      {
        id: "pane",
        items: [
          {
            id: "splitRight",
            label: "Split Right",
            shortcut: isMac ? "\u2318D" : "Ctrl+D",
            onClick: () => splitFocusedPane("horizontal"),
          },
          {
            id: "splitDown",
            label: "Split Down",
            shortcut: isMac ? "\u21E7\u2318\u23CE" : "Ctrl+Shift+Enter",
            onClick: () => splitFocusedPane("vertical"),
          },
          {
            id: "closePane",
            label: "Close Pane",
            shortcut: isMac ? "\u2318W" : "Ctrl+W",
            enabled: hasMultiplePanes ?? undefined,
            onClick: () => closeFocusedPane(),
          },
        ],
      },
      // Window group
      {
        id: "window",
        items: [
          {
            id: "newWindow",
            label: "New Window",
            shortcut: isMac ? "\u2318N" : "Ctrl+N",
            onClick: () => createNewWindow(),
          },
        ],
      },
      // Features group
      {
        id: "features",
        items: [
          {
            id: "toggleMcp",
            label: hasMcp ? "Disconnect MCP" : "Connect MCP",
            indicator: "mcp",
            indicatorActive: hasMcp,
            onClick: () => {
              if (contextMenu.sessionId) {
                handleMcpToggle(contextMenu.sessionId);
              }
            },
          },
        ],
      },
    ];
  }, [
    rootPane,
    contextMenu.sessionId,
    contextMenu.terminalMethods,
    mcpAttachedSessionId,
    splitFocusedPane,
    closeFocusedPane,
    createNewWindow,
    handleMcpToggle,
    addToast,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when modal is open (except settings)
      if (showModeModal) return;

      const isMod = isMac ? e.metaKey : e.ctrlKey;

      // Cmd+, - Open settings
      if (isMod && e.key === ",") {
        e.preventDefault();
        openSettings();
        return;
      }

      // Cmd+Shift+A - Toggle Claude Code panel
      if (isMod && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handleClaudeToggle();
        return;
      }

      // Cmd+Shift+D - Split vertically (stacked)
      if (isMod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        splitFocusedPane("vertical");
        return;
      }

      // Plugin sidebar shortcuts (Cmd+Shift+E for agent context, etc.)
      if (handlePluginShortcut(e)) return;

      // Cmd+Shift+X - Test crash reporter (dev only)
      if (isMod && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        // Call the test function exposed by CrashReporterProvider
        const testFn = (window as unknown as { __testCrashReporter?: () => void }).__testCrashReporter;
        if (testFn) testFn();
        return;
      }

      // Cmd+F - Open find bar
      if (isMod && e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        setShowFindBar(true);
        return;
      }

      // Escape - Close find bar (if open)
      if (e.key === "Escape" && showFindBar) {
        e.preventDefault();
        closeFindBar();
        return;
      }

      // Cmd+W - Close editor/diff panel first, then focused pane or tab
      if (isMod && e.key === "w") {
        e.preventDefault();
        if (editorFile) {
          setEditorFile(null);
        } else {
          closeFocusedPane();
        }
        return;
      }

      // Cmd+D - Split horizontally (side-by-side)
      if (isMod && !e.shiftKey && e.key === "d") {
        e.preventDefault();
        splitFocusedPane("horizontal");
        return;
      }

      // Cmd+Shift+Enter - Split vertically (stacked)
      if (isMod && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        splitFocusedPane("vertical");
        return;
      }

      // Cmd+] - Next pane, Cmd+[ - Previous pane
      if (isMod && e.key === "]") {
        e.preventDefault();
        cycleFocus("next");
        return;
      }
      if (isMod && e.key === "[") {
        e.preventDefault();
        cycleFocus("prev");
        return;
      }

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    showModeModal,
    showFindBar,
    closeFindBar,
    closeFocusedPane,
    splitFocusedPane,
    navigateFocus,
    cycleFocus,
    openSettings,
    editorFile,
    handleClaudeToggle,
    handlePluginShortcut,
  ]);

  // Check if welcome modal should be shown (first window only)
  useEffect(() => {
    if (!isFirstAppWindow) {
      // Not first window, skip welcome check and show mode modal
      setWelcomeCheckComplete(true);
      setShowModeModal(true);
      return;
    }

    // Check if user has seen welcome
    window.terminalAPI.analyticsHasSeenWelcome()
      .then((hasSeen) => {
        if (hasSeen) {
          // Already seen welcome, show mode modal
          setShowModeModal(true);
        } else {
          // Show welcome modal
          setShowWelcomeModal(true);
        }
        setWelcomeCheckComplete(true);
      })
      .catch((err) => {
        console.error("Failed to check welcome state:", err);
        // On error, show mode modal
        setWelcomeCheckComplete(true);
        setShowModeModal(true);
      });
  }, []);

  // Handle welcome modal completion
  const handleWelcomeComplete = useCallback(async (analyticsEnabled: boolean) => {
    try {
      // Save consent
      await window.terminalAPI.analyticsSetConsent(analyticsEnabled);
      // Mark welcome as seen
      await window.terminalAPI.analyticsMarkWelcomeSeen();
    } catch (err) {
      console.error("Failed to save analytics consent:", err);
    }

    // Close welcome modal and show mode selection
    setShowWelcomeModal(false);
    setShowModeModal(true);
  }, []);

  // Listen for session close events
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as { type: string; sessionId?: string };
      if (msg.type === "session-closed" && msg.sessionId) {
        handleSessionClose(msg.sessionId);
      }
    });
    return cleanup;
  }, [handleSessionClose]);

  // Track previous MCP attachment state for toast notification
  const prevMcpAttachedRef = useRef<string | null>(null);

  // Fetch initial MCP attachment state and subscribe to changes
  useEffect(() => {
    window.terminalAPI
      .mcpGetAttached()
      .then((sessionId) => {
        prevMcpAttachedRef.current = sessionId;
        setMcpAttachedSessionId(sessionId);
      })
      .catch(console.error);

    const cleanup = window.terminalAPI.onMcpAttachmentChanged((data) => {
      const prevAttached = prevMcpAttachedRef.current;
      const newAttached = data.attachedSessionId;

      // Track MCP attachment changes
      if (prevAttached === null && newAttached !== null) {
        trackMcpAttachment(true);
      } else if (prevAttached !== null && newAttached === null) {
        trackMcpAttachment(false);
      }

      // Show toast when MCP transitions from disabled to enabled
      if (prevAttached === null && newAttached !== null) {
        addToast({
          message: "MCP is now enabled. You may connect an AI agent.",
          variant: "success",
          duration: 8000,
          action: {
            label: "View Instructions",
            onClick: () => setShowMcpInstructions(true),
          },
        });
      }

      prevMcpAttachedRef.current = newAttached;
      setMcpAttachedSessionId(newAttached);
    });
    return cleanup;
  }, [addToast]);

  // Listen for socket takeover (another brosh instance took our socket)
  useEffect(() => {
    const cleanup = window.terminalAPI.onMcpSocketLost((data) => {
      console.log("[App] MCP socket lost:", data);

      // Show error toast
      addToast({
        message: "MCP disconnected: Another brosh instance took over the socket",
        variant: "error",
        duration: 8000,
      });

      // Detach MCP to update UI state
      window.terminalAPI.mcpDetach().catch(console.error);
    });
    return cleanup;
  }, [addToast]);

  // Listen for auto-updater status changes
  useEffect(() => {
    const cleanup = window.terminalAPI.onUpdaterStatus((status) => {
      if (status.state === "available") {
        const version = status.availableVersion || "new version";
        addToast({
          message: `Update v${version} is available`,
          variant: "info",
          duration: 60_000,
          action: status.manualRequired
            ? {
                label: "View Release",
                onClick: () => {
                  window.terminalAPI.openExternal(
                    `https://github.com/elleryfamilia/brosh/releases/tag/v${version}`
                  );
                },
              }
            : {
                label: "Download",
                onClick: () => {
                  window.terminalAPI.updaterDownload();
                },
              },
        });
      } else if (status.state === "downloaded") {
        addToast({
          message: "Update downloaded. Restart to apply.",
          variant: "success",
          duration: 300_000,
          action: {
            label: "Restart Now",
            onClick: () => {
              window.terminalAPI.updaterInstall();
            },
          },
        });
      } else if (status.state === "error" && status.error) {
        addToast({
          message: `Update error: ${status.error}`,
          variant: "error",
          duration: 5000,
        });
      }
    });
    return cleanup;
  }, [addToast]);

  // Listen for menu preferences event
  useEffect(() => {
    const cleanup = window.terminalAPI.onMenuPreferences(() => {
      openSettings();
    });
    return cleanup;
  }, [openSettings]);

  // Listen for menu events (close, clear, scroll, split)
  useEffect(() => {
    const cleanups = [
      window.terminalAPI.onMenuCloseTerminal(() => closeFocusedPane()),
      window.terminalAPI.onMenuClearTerminal(() => findBarTerminalMethodsRef.current?.clear()),
      window.terminalAPI.onMenuScrollToTop(() => findBarTerminalMethodsRef.current?.scrollToTop()),
      window.terminalAPI.onMenuScrollToBottom(() => findBarTerminalMethodsRef.current?.scrollToBottom()),
      window.terminalAPI.onMenuSplitRight(() => splitFocusedPane("horizontal")),
      window.terminalAPI.onMenuSplitDown(() => splitFocusedPane("vertical")),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, [closeFocusedPane, splitFocusedPane]);

  // Fetch home directory once on mount
  useEffect(() => {
    window.terminalAPI.getHomedir().then((dir) => {
      homedirRef.current = dir;
    });
  }, []);

  // Track focused terminal CWD for Claude button visibility
  useEffect(() => {
    if (!currentFocusedSessionId) {
      setFocusedCwd(null);
      return;
    }
    let cancelled = false;
    const fetchCwd = (retries: number) => {
      window.terminalAPI.getCwd(currentFocusedSessionId).then((result) => {
        if (cancelled) return;
        if (result.success && result.cwd) {
          setFocusedCwd(result.cwd);
        } else if (retries > 0) {
          setTimeout(() => fetchCwd(retries - 1), 300);
        }
      });
    };
    fetchCwd(3);
    return () => { cancelled = true; };
  }, [currentFocusedSessionId]);

  // Close/keep/ask about the diff panel when the project root changes
  const prevProjectRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevProjectRootRef.current !== null &&
        prevProjectRootRef.current !== projectRoot &&
        editorFile) {
      // If the open file is inside the NEW project root the diff is still
      // valid — no reason to prompt.  This avoids false positives when the
      // user cd's back into the project where Claude opened the diff.
      const fileStillInProject = projectRoot && editorFile.filePath.startsWith(projectRoot);
      if (!fileStillInProject) {
        const pref = settings.git?.closeDiffOnDirChange ?? 'ask';
        if (pref === 'close') {
          setEditorFile(null);
        } else if (pref === 'ask') {
          setShowDiffBanner(true);
        }
        // 'keep' → do nothing
      }
    }
    prevProjectRootRef.current = projectRoot;
  }, [projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track focused CWD from terminal events (for Claude button visibility)
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as { type: string; sessionId?: string; cwd?: string };
      if (msg.type === 'cwd-changed' && msg.cwd) {
        const sessionId = getFocusedSessionId();
        if (msg.sessionId === sessionId) {
          setFocusedCwd(msg.cwd);
        }
      }
    });
    return cleanup;
  }, [getFocusedSessionId]);

  // Listen for process change events
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as {
        type: string;
        sessionId?: string;
        process?: string;
      };
      if (msg.type === "process-changed" && msg.sessionId && msg.process) {
        const newProcess = msg.process as string;
        const sid = msg.sessionId as string;

        // Update pane tree with new process name
        setRootPane((prev) =>
          prev ? updateTerminalProcessName(prev, sid, newProcess) : prev
        );

        // AI TUI detection: detect shell↔claude transitions
        // Claude CLI briefly appears as "claude" then hands off to a versioned
        // worker binary (e.g. "2.1.32"). The debounced process check may skip
        // the launcher entirely, so we also match the worker pattern.
        const baseName = newProcess.split("/").pop() || newProcess;
        const prevProcess = sessionProcessRef.current.get(sid) || "";
        const prevBaseName = prevProcess.split("/").pop() || prevProcess;
        sessionProcessRef.current.set(sid, newProcess);

        const isAiCli = AI_CLI_PROCESSES.has(baseName) || CLAUDE_WORKER_RE.test(baseName);
        const isShell = SHELL_PROCESSES.has(baseName);
        const wasShell = SHELL_PROCESSES.has(prevBaseName);
        const alreadyActive = aiTuiActiveSessionsRef.current.has(sid);

        if (!alreadyActive && (wasShell || prevBaseName === "") && isAiCli) {
          aiTuiActiveSessionsRef.current.add(sid);
        } else if (alreadyActive && isShell) {
          aiTuiActiveSessionsRef.current.delete(sid);
        }
      }
    });
    return cleanup;
  }, []);

  // Listen for window title change events (OSC sequences from applications like Claude Code)
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as {
        type: string;
        sessionId?: string;
        title?: string;
      };
      if (msg.type === "title-changed" && msg.sessionId) {
        setRootPane((prev) =>
          prev ? updateWindowTitle(prev, msg.sessionId as string, msg.title) : prev
        );
      }
    });
    return cleanup;
  }, []);

  // Listen for error detection events
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as {
        type: string;
        sessionId?: string;
        exitCode?: number;
        command?: string;
        summary?: string;
        timestamp?: number;
      };
      if (msg.type === "error-detected" && msg.sessionId) {
        setErrorNotifications((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId as string, {
            sessionId: msg.sessionId as string,
            exitCode: msg.exitCode,
            command: msg.command,
            summary: msg.summary,
            timestamp: msg.timestamp ?? Date.now(),
          });
          return next;
        });
      } else if (msg.type === "error-dismissed" && msg.sessionId) {
        setErrorNotifications((prev) => {
          const next = new Map(prev);
          next.delete(msg.sessionId as string);
          return next;
        });
      }
    });
    return cleanup;
  }, []);

  // Dismiss error notification handler
  const handleDismissError = useCallback((sessionId: string) => {
    setErrorNotifications((prev) => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  // Listen for Claude session ID changes (emitted by terminal-bridge when AI invocation captures session ID)
  useEffect(() => {
    const cleanup = window.terminalAPI.onClaudeSessionChanged((data) => {
      setClaudeSessionIds((prev) => {
        const next = new Map(prev);
        next.set(data.sessionId, data.claudeSessionId);
        return next;
      });
    });
    return cleanup;
  }, []);

  // IDE protocol: listen for openFile and openDiff commands from Claude Code
  useEffect(() => {
    const cleanupOpenFile = window.terminalAPI.onIdeOpenFile((data) => {
      setActiveSidebarPlugin('git');
      setEditorFile({
        filePath: data.filePath,
        isDiff: false,
        diffSource: "git-head",
      });
    });

    const cleanupOpenDiff = window.terminalAPI.onIdeOpenDiff((data) => {
      setActiveSidebarPlugin('git');
      setEditorFile({
        filePath: data.filePath,
        isDiff: true,
        diffSource: { oldContent: data.oldContent, newContent: data.newContent },
      });
    });

    return () => {
      cleanupOpenFile();
      cleanupOpenDiff();
    };
  }, []);

  // IDE protocol: report file opens to Claude Code
  useEffect(() => {
    if (editorFile?.filePath) {
      window.terminalAPI.ideReportFileOpen(editorFile.filePath);
    }
  }, [editorFile?.filePath]);

  // Build pane info for title bar
  const titleBarPaneInfo = (() => {
    if (!rootPane || !focusedPaneId) return null;
    const focusedPane = findPaneById(rootPane, focusedPaneId);
    const terminalPane =
      focusedPane && isTerminalPane(focusedPane)
        ? focusedPane
        : getFirstTerminalPane(rootPane);
    const hasMultiplePanes = !isTerminalPane(rootPane);
    const allPanes = getAllTerminalPanes(rootPane);
    const hasMcpSession = mcpAttachedSessionId !== null &&
      allPanes.some((p) => p.sessionId === mcpAttachedSessionId);
    const focusedPaneHasMcp = terminalPane?.sessionId === mcpAttachedSessionId;
    return {
      sessionId: terminalPane?.sessionId || "",
      processName: terminalPane?.processName || "shell",
      windowTitle: terminalPane?.windowTitle,
      isSandboxed: terminalPane?.isSandboxed || false,
      sandboxConfig: terminalPane?.sandboxConfig,
      hasMultiplePanes,
      hasMcpSession,
      focusedPaneHasMcp,
    };
  })();

  // Check if we have exactly one terminal (single pane, not split)
  const isSingleTerminal = rootPane && isTerminalPane(rootPane);

  // Project name for Claude button (basename of CWD, null when in home/root directory)
  const claudeProjectName = (() => {
    if (!focusedCwd) return null;
    const homedir = homedirRef.current;
    if (focusedCwd === '/' || focusedCwd === homedir) return null;
    return focusedCwd.split('/').pop() ?? null;
  })();

  // Whether the focused terminal is inside a git project
  const claudeProjectIsGit = !!(projectRoot && focusedCwd?.startsWith(projectRoot));

  // Alias for status bar and Claude panel props
  const focusedSessionId = currentFocusedSessionId;

  // Render error state (only if no pane and no modal)
  if (error && !rootPane && !showModeModal) {
    return (
      <div className="app app-error">
        <div className="error-icon">!</div>
        <h2>Failed to start terminal</h2>
        <p>{error}</p>
        <button
          onClick={() => {
            setError(null);
            setShowModeModal(true);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Render main UI
  return (
    <div className="app">
      {isMac && (
        <TitleBar
          paneInfo={titleBarPaneInfo}
          mcpAttachedSessionId={mcpAttachedSessionId}
          isSingleTerminal={!!isSingleTerminal}
          onOpenSettings={openSettings}
          onMcpToggle={handleMcpToggle}
          onSandboxClick={handleSandboxClick}
          onClaudeToggle={handleClaudeToggle}
          claudePanelOpen={showClaudePanel}
          claudeProjectName={claudeProjectName}
          claudeProjectIsGit={claudeProjectIsGit}
        />
      )}
      <div className="terminal-container">
        <SidebarHost
          activePluginId={activeSidebarPlugin}
          workspace={workspace}
          onOpenFile={handleOpenEditorFile}
          onCloseEditor={handleEditorClose}
          editorFilePath={editorFile?.filePath ?? null}
          onClose={() => { if (activeSidebarPlugin) togglePlugin(activeSidebarPlugin); }}
          onWidthChange={setSidebarWidth}
        />
        {showFindBar && rootPane && (
          <FindBar
            isOpen={showFindBar}
            onClose={closeFindBar}
            onFindNext={(term, opts) =>
              findBarTerminalMethodsRef.current?.findNext(term, opts) ?? false
            }
            onFindPrevious={(term, opts) =>
              findBarTerminalMethodsRef.current?.findPrevious(term, opts) ?? false
            }
            onClearSearch={() =>
              findBarTerminalMethodsRef.current?.clearSearch()
            }
          />
        )}
        {activeSidebarPlugin && editorFile && (() => {
          const activePlugin = getPlugin(activeSidebarPlugin);
          const CustomEditorPanel = activePlugin?.EditorPanel;

          return (
            <div className="editor-panel" style={{
              left: sidebarWidth,
              width: showClaudePanel
                ? `calc(100% - ${sidebarWidth}px - ${claudePanelWidth}px)`
                : `calc((100% - ${sidebarWidth}px) / 2)`,
            }}>
              {showDiffBanner && (
                <div className="diff-change-overlay">
                  <div className="diff-change-modal">
                    <div className="diff-change-modal-title">Directory changed</div>
                    <div className="diff-change-modal-desc">Close the diff panel?</div>
                    <div className="diff-change-modal-actions">
                      <button className="diff-change-btn diff-change-btn-primary" onClick={() => {
                        if (diffBannerRememberRef.current) {
                          updateAppSettings({ git: { closeDiffOnDirChange: 'close' } });
                        }
                        setEditorFile(null);
                        setShowDiffBanner(false);
                        diffBannerRememberRef.current = false;
                      }}>
                        Close
                      </button>
                      <button className="diff-change-btn" onClick={() => {
                        if (diffBannerRememberRef.current) {
                          updateAppSettings({ git: { closeDiffOnDirChange: 'keep' } });
                        }
                        setShowDiffBanner(false);
                        diffBannerRememberRef.current = false;
                      }}>
                        Keep Open
                      </button>
                    </div>
                    <label className="diff-change-modal-remember">
                      <input type="checkbox" onChange={(e) => { diffBannerRememberRef.current = e.target.checked; }} />
                      <span>Remember this</span>
                    </label>
                  </div>
                </div>
              )}
              {CustomEditorPanel ? (
                <CustomEditorPanel
                  filePath={editorFile.filePath}
                  onClose={handleEditorClose}
                />
              ) : (
                <EditorPane
                  paneId="editor-panel"
                  filePath={editorFile.filePath}
                  isDiff={editorFile.isDiff}
                  diffSource={editorFile.diffSource}
                  isFocused={true}
                  isVisible={true}
                  onFocus={() => {}}
                  onClose={handleEditorClose}
                />
              )}
            </div>
          );
        })()}
        {rootPane && focusedPaneId ? (() => {
          const editorActive = !!(activeSidebarPlugin && editorFile);
          const hideTerminals = editorActive && showClaudePanel;

          return (
          <div
            className={`terminal-wrapper ${hideTerminals ? "hidden" : "visible"}`}
            style={{
              left: editorActive && !showClaudePanel
                ? `calc(${sidebarWidth}px + (100% - ${sidebarWidth}px) / 2)`
                : sidebarWidth,
              right: showClaudePanel ? claudePanelWidth : 0,
            }}
          >
            <PaneContainer
              pane={rootPane}
              focusedPaneId={focusedPaneId}
              isTabVisible={true}
              mcpAttachedSessionId={mcpAttachedSessionId}
              isSinglePane={isTerminalPane(rootPane)}
              hideHeader={!!isSingleTerminal && isMac}
              onOpenSettings={!isMac ? openSettings : undefined}
              onFocus={setFocusedPane}
              onSessionClose={handleSessionClose}
              onSplitRatioChange={handleSplitRatioChange}
              onPendingModeSelected={handlePendingModeSelected}
              onPendingCancel={handlePendingCancel}
              onMcpToggle={handleMcpToggle}
              onSandboxClick={handleSandboxClick}
              onClaudeToggle={!isMac ? handleClaudeToggle : undefined}
              claudePanelOpen={showClaudePanel}
              claudeProjectName={claudeProjectName}
              claudeProjectIsGit={claudeProjectIsGit}
              onContextMenu={handleContextMenu}
              onTerminalMethodsReady={handleTerminalMethodsReady}
              onFileLink={handleFileLink}
              onAddToChat={claudePanelSessionId ? handleAddToChat : undefined}
              errorNotifications={errorNotifications}
              onDismissError={handleDismissError}
            />
          </div>
          );
        })() : null}
        {!rootPane && !showModeModal && !showWelcomeModal && welcomeCheckComplete && (
          <div className="no-tabs">
            <p>No terminals open</p>
            <button onClick={() => setShowModeModal(true)}>New Terminal</button>
          </div>
        )}
        {(showClaudePanel || claudePanelSessionId) && (
          <ClaudePanel
            sessionId={claudePanelSessionId}
            onSessionCreated={setClaudePanelSessionId}
            width={claudePanelWidth}
            onResize={handleClaudePanelResize}
            onClose={() => setShowClaudePanel(false)}
            visible={showClaudePanel}
            getCwd={getClaudePanelCwd}
            projectName={claudeProjectName}
            focusedSessionId={focusedSessionId}
          />
        )}
      </div>
      <SmartStatusBar
        mcpAttachedSessionId={mcpAttachedSessionId}
        focusedSessionId={focusedSessionId}
        claudeSessionId={focusedSessionId ? claudeSessionIds.get(focusedSessionId) ?? null : null}
        workspace={workspace}
        activeSidebarPlugin={activeSidebarPlugin}
        onTogglePlugin={togglePlugin}
        onShowMcpInstructions={() => setShowMcpInstructions(true)}
      />
      <McpConflictDialog
        isOpen={conflictDialog.isOpen}
        onCancel={handleConflictCancel}
        onConfirm={handleConflictConfirm}
      />
      <McpDisconnectDialog
        isOpen={showDisconnectDialog}
        onCancel={handleDisconnectCancel}
        onConfirm={handleDisconnectConfirm}
      />
      <McpInstructionsModal
        isOpen={showMcpInstructions}
        onClose={() => setShowMcpInstructions(false)}
      />
      {sandboxTooltipConfig && (
        <SandboxSettingsTooltip
          isOpen={true}
          config={sandboxTooltipConfig}
          onClose={handleSandboxTooltipClose}
        />
      )}
      <WelcomeModal
        isOpen={showWelcomeModal}
        onComplete={handleWelcomeComplete}
      />
      <ModeSelectionModal
        isOpen={showModeModal && !showWelcomeModal}
        onModeSelected={handleModeSelected}
        showLogo={isFirstAppWindow && !hasCreatedFirstTerminal.current}
      />
      <SettingsPanel isOpen={showSettingsPanel} onClose={closeSettings} />
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        groups={buildContextMenuGroups()}
        onClose={closeContextMenu}
      />
    </div>
  );
}
