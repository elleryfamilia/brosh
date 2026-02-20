/**
 * Main Application Component
 *
 * Root component that manages the terminal layout and multi-tab state.
 * Supports split panes within each tab.
 * Shows mode selection dialog for new tabs, inline selector for split panes.
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
import type { TabState, SplitDirection, PaneSandboxConfig, DiffSource } from "./types/pane";
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
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabCounter = useRef(0);

  // Welcome modal state (first-launch only)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeCheckComplete, setWelcomeCheckComplete] = useState(false);

  // Mode selection modal state (for new tabs only)
  const [showModeModal, setShowModeModal] = useState(false);

  // Track if this is the initial terminal creation in this window (for logo display)
  // Logo only shows on first terminal of first window
  const hasCreatedFirstTerminal = useRef(false);

  // Track which mode was selected for the pending tab creation
  const pendingTabModeRef = useRef<"direct" | "sandbox">("direct");
  // Track the last sandbox config so it can be reused when skipping the modal
  const pendingTabConfigRef = useRef<SandboxConfig | undefined>(undefined);

  // Keep refs to current state for use in callbacks without stale closures
  const tabsRef = useRef<TabState[]>([]);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;

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
    const activeTab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (!activeTab) return null;
    const pane = findPaneById(activeTab.rootPane, activeTab.focusedPaneId);
    return pane && isTerminalPane(pane) ? pane.sessionId : null;
  }, []);

  // Compute focused session ID for dependency tracking
  const currentFocusedSessionId = (() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return null;
    const pane = findPaneById(tab.rootPane, tab.focusedPaneId);
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

  // Helper to get the active tab
  const getActiveTab = useCallback(() => {
    return tabsRef.current.find((t) => t.id === activeTabIdRef.current) || null;
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

      let processName = "shell";
      try {
        const processResult = await window.terminalAPI.getProcess(
          result.sessionId
        );
        if (processResult.success && processResult.process) {
          processName = processResult.process;
        }
      } catch {
        // Use default
      }

      return {
        sessionId: result.sessionId,
        processName,
        isSandboxed: mode === "sandbox",
        sandboxConfig: mode === "sandbox" ? config : undefined,
      };
    },
    []
  );

  // Create a new tab with a single terminal pane
  const createTabWithMode = useCallback(
    async (mode: "direct" | "sandbox", config?: SandboxConfig) => {
      try {
        const { sessionId, processName, isSandboxed, sandboxConfig } = await createTerminalSession(
          mode,
          config
        );
        const tabId = `tab-${++tabCounter.current}`;
        const pane = createTerminalPane(sessionId, processName, isSandboxed, sandboxConfig);

        const newTab: TabState = {
          id: tabId,
          title: `Terminal ${tabCounter.current}`,
          rootPane: pane,
          focusedPaneId: pane.id,
          isActive: true,
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);

        return tabId;
      } catch (err) {
        console.error("Failed to create tab:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create terminal"
        );
        return null;
      }
    },
    [createTerminalSession]
  );

  // Request to create a new tab (shows modal, or skips if setting is off)
  const requestNewTab = useCallback(() => {
    if (hasCreatedFirstTerminal.current && !settings.terminal.askModeForNewTerminals) {
      createTabWithMode(pendingTabModeRef.current, pendingTabConfigRef.current);
      trackTerminalCreated(pendingTabModeRef.current, false);
      return;
    }
    setShowModeModal(true);
  }, [settings.terminal.askModeForNewTerminals, createTabWithMode]);

  // Handle mode selection from modal (for new tabs)
  const handleModeSelected = useCallback(
    async (mode: "direct" | "sandbox", config?: SandboxConfig) => {
      hasCreatedFirstTerminal.current = true;
      setShowModeModal(false);
      pendingTabModeRef.current = mode;
      pendingTabConfigRef.current = config;
      await createTabWithMode(mode, config);
      // Track terminal creation
      trackTerminalCreated(mode, false);
    },
    [createTabWithMode]
  );

  // Split the focused pane immediately with a pending pane (or skip modal if setting is off)
  const splitFocusedPane = useCallback(
    (direction: SplitDirection) => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      // Don't allow split if there's already a pending pane
      if (hasPendingPanes(activeTab.rootPane)) return;

      // Skip the pending pane and create terminal directly if setting is off
      if (hasCreatedFirstTerminal.current && !settings.terminal.askModeForNewTerminals) {
        const tabId = activeTab.id;
        createTerminalSession(pendingTabModeRef.current, pendingTabConfigRef.current)
          .then(({ sessionId, processName, isSandboxed, sandboxConfig }) => {
            const terminalPane = createTerminalPane(sessionId, processName, isSandboxed, sandboxConfig);
            setTabs((prev) => {
              const tab = prev.find((t) => t.id === tabId);
              if (!tab) return prev;
              const newRoot = splitPaneInTree(tab.rootPane, tab.focusedPaneId, direction, terminalPane);
              return prev.map((t) =>
                t.id === tabId ? { ...t, rootPane: newRoot, focusedPaneId: terminalPane.id } : t
              );
            });
            trackTerminalCreated(pendingTabModeRef.current, true);
          })
          .catch((err) => {
            console.error("Failed to create terminal for split:", err);
          });
        return;
      }

      const pendingPane = createPendingPane();
      const newRootPane = splitPaneInTree(
        activeTab.rootPane,
        activeTab.focusedPaneId,
        direction,
        pendingPane
      );

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                rootPane: newRootPane,
                focusedPaneId: pendingPane.id, // Focus the pending pane so modal gets focus
              }
            : t
        )
      );
    },
    [getActiveTab, settings.terminal.askModeForNewTerminals, createTerminalSession]
  );

  // Handle mode selection from inline pending pane
  const handlePendingModeSelected = useCallback(
    async (
      paneId: string,
      mode: "direct" | "sandbox",
      config?: SandboxConfig
    ) => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      // Store mode and config so subsequent terminals can reuse them
      pendingTabModeRef.current = mode;
      pendingTabConfigRef.current = config;

      try {
        // TODO: Implement proper cwd inheritance for splits
        // For now, all new terminals start in home directory (set by backend)
        const { sessionId, processName, isSandboxed, sandboxConfig } = await createTerminalSession(
          mode,
          config
        );
        const terminalPane = createTerminalPane(sessionId, processName, isSandboxed, sandboxConfig);
        // Preserve the pane ID so focus works correctly
        terminalPane.id = paneId;

        const newRootPane = replacePaneInTree(
          activeTab.rootPane,
          paneId,
          terminalPane
        );

        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? {
                  ...t,
                  rootPane: newRootPane,
                  focusedPaneId: paneId, // Focus the new terminal
                }
              : t
          )
        );

        // Track terminal creation (split)
        trackTerminalCreated(mode, true);
      } catch (err) {
        console.error("Failed to create terminal in pane:", err);
        // Remove the pending pane on error
        const newRootPane = removePaneFromTree(activeTab.rootPane, paneId);
        if (newRootPane) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTab.id ? { ...t, rootPane: newRootPane } : t
            )
          );
        }
      }
    },
    [getActiveTab, createTerminalSession]
  );

  // Handle cancellation of pending pane (escape key)
  const handlePendingCancel = useCallback(
    (paneId: string) => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      const newRootPane = removePaneFromTree(activeTab.rootPane, paneId);
      if (newRootPane) {
        // Find a terminal pane to focus
        const terminalToFocus = getFirstTerminalPane(newRootPane);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? {
                  ...t,
                  rootPane: newRootPane,
                  focusedPaneId: terminalToFocus?.id || t.focusedPaneId,
                }
              : t
          )
        );
      }
    },
    [getActiveTab]
  );

  // Remove a tab from state
  const removeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== tabId);

      // If no more tabs, close the window
      if (newTabs.length === 0) {
        window.close();
        return newTabs;
      }

      setActiveTabId((currentActiveTabId) => {
        if (currentActiveTabId === tabId && newTabs.length > 0) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActiveIndex = Math.min(closedIndex, newTabs.length - 1);
          return newTabs[newActiveIndex].id;
        }
        return currentActiveTabId;
      });

      return newTabs;
    });
  }, []);

  // Close a tab (closes all its sessions)
  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (tab) {
        const terminals = getAllTerminalPanes(tab.rootPane);
        terminals.forEach((terminal) => {
          window.terminalAPI
            .closeSession(terminal.sessionId)
            .catch(console.error);
        });
      }
      removeTab(tabId);
    },
    [removeTab]
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

      for (const tab of tabsRef.current) {
        const terminals = getAllTerminalPanes(tab.rootPane);
        const terminal = terminals.find((t) => t.sessionId === sessionId);

        if (terminal) {
          if (terminals.length === 1) {
            removeTab(tab.id);
          } else {
            const newRootPane = removePaneFromTree(tab.rootPane, terminal.id);
            if (newRootPane) {
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === tab.id
                    ? {
                        ...t,
                        rootPane: newRootPane,
                        focusedPaneId:
                          t.focusedPaneId === terminal.id
                            ? getFirstTerminalPane(newRootPane)?.id ||
                              t.focusedPaneId
                            : t.focusedPaneId,
                      }
                    : t
                )
              );
            }
          }
          break;
        }
      }
    },
    [removeTab]
  );

  // Close the focused pane (Cmd+W)
  const closeFocusedPane = useCallback(() => {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    const focusedPane = findPaneById(
      activeTab.rootPane,
      activeTab.focusedPaneId
    );
    if (!focusedPane) return;

    // Handle closing a pending pane (cancel the split)
    if (isPendingPane(focusedPane)) {
      const newRootPane = removePaneFromTree(
        activeTab.rootPane,
        focusedPane.id
      );
      if (newRootPane) {
        const newFocusedPane = getFirstTerminalPane(newRootPane);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? {
                  ...t,
                  rootPane: newRootPane,
                  focusedPaneId: newFocusedPane?.id || t.focusedPaneId,
                }
              : t
          )
        );
      }
      return;
    }

    if (!isTerminalPane(focusedPane)) return;

    const terminals = getAllTerminalPanes(activeTab.rootPane);
    if (terminals.length === 1) {
      closeTab(activeTab.id);
    } else {
      window.terminalAPI
        .closeSession(focusedPane.sessionId)
        .catch(console.error);

      const newRootPane = removePaneFromTree(
        activeTab.rootPane,
        focusedPane.id
      );
      if (newRootPane) {
        const newFocusedPane = getFirstTerminalPane(newRootPane);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? {
                  ...t,
                  rootPane: newRootPane,
                  focusedPaneId: newFocusedPane?.id || t.focusedPaneId,
                }
              : t
          )
        );
      }
    }
  }, [getActiveTab, closeTab]);

  // Navigate focus between panes (directional)
  const navigateFocus = useCallback(
    (direction: NavigationDirection) => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      const adjacentPaneId = findAdjacentPane(
        activeTab.rootPane,
        activeTab.focusedPaneId,
        direction
      );

      if (adjacentPaneId) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id ? { ...t, focusedPaneId: adjacentPaneId } : t
          )
        );
      }
    },
    [getActiveTab]
  );

  // Cycle focus between panes (Cmd+] / Cmd+[)
  const cycleFocus = useCallback(
    (direction: "next" | "prev") => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      const nextPane = getAdjacentTerminalPane(
        activeTab.rootPane,
        activeTab.focusedPaneId,
        direction
      );

      if (nextPane) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id ? { ...t, focusedPaneId: nextPane.id } : t
          )
        );
      }
    },
    [getActiveTab]
  );

  // Set focused pane (from click)
  const setFocusedPane = useCallback((paneId: string) => {
    const activeTabId = activeTabIdRef.current;
    if (!activeTabId) return;

    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, focusedPaneId: paneId } : t
      )
    );

    // Close find bar when terminal is clicked/focused
    if (showFindBarRef.current) {
      setShowFindBar(false);
      findBarTerminalMethodsRef.current?.clearSearch();
    }
  }, []);

  // Update split ratio
  const handleSplitRatioChange = useCallback(
    (splitPaneId: string, newRatio: number) => {
      const activeTabId = activeTabIdRef.current;
      if (!activeTabId) return;

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                rootPane: updateSplitRatio(t.rootPane, splitPaneId, newRatio),
              }
            : t
        )
      );
    },
    []
  );

  // Switch to a tab
  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

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
      const activeTab = getActiveTab();
      if (activeTab && paneId === activeTab.focusedPaneId && methods) {
        findBarTerminalMethodsRef.current = methods;
      }
    },
    [getActiveTab]
  );

  // Handle file link click from terminal
  const handleFileLink = useCallback(
    async (filePath: string, isDiff: boolean) => {
      const activeTab = getActiveTab();
      if (!activeTab) return;

      // Resolve relative paths using the terminal's cwd
      let resolvedPath = filePath;
      if (!filePath.startsWith("/")) {
        const focusedPane = findPaneById(activeTab.rootPane, activeTab.focusedPaneId);
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
    [getActiveTab]
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
    const activeTab = getActiveTab();
    const hasMultiplePanes = activeTab && !isTerminalPane(activeTab.rootPane);
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
      // Tab/Window group
      {
        id: "tabWindow",
        items: [
          {
            id: "newTab",
            label: "New Tab",
            shortcut: isMac ? "\u2318T" : "Ctrl+T",
            onClick: () => requestNewTab(),
          },
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
    getActiveTab,
    contextMenu.sessionId,
    contextMenu.terminalMethods,
    mcpAttachedSessionId,
    splitFocusedPane,
    closeFocusedPane,
    requestNewTab,
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

      // Cmd+T - New tab
      if (isMod && e.key === "t") {
        e.preventDefault();
        requestNewTab();
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

      // Cmd+1-9 - Switch tabs
      if (isMod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const currentTabs = tabsRef.current;
        if (index < currentTabs.length) {
          setActiveTabId(currentTabs[index].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    showModeModal,
    showFindBar,
    closeFindBar,
    requestNewTab,
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
    window.terminalAPI.getCwd(currentFocusedSessionId).then((result) => {
      if (result.success && result.cwd) setFocusedCwd(result.cwd);
    });
  }, [currentFocusedSessionId]);

  // Close/keep/ask about the diff panel when the project root changes
  const prevProjectRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevProjectRootRef.current !== null &&
        prevProjectRootRef.current !== projectRoot &&
        editorFile) {
      const pref = settings.git?.closeDiffOnDirChange ?? 'ask';
      if (pref === 'close') {
        setEditorFile(null);
      } else if (pref === 'ask') {
        setShowDiffBanner(true);
      }
      // 'keep' → do nothing
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
        setTabs((prev) =>
          prev.map((tab) => ({
            ...tab,
            rootPane: updateTerminalProcessName(
              tab.rootPane,
              sid,
              newProcess
            ),
          }))
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
        setTabs((prev) =>
          prev.map((tab) => ({
            ...tab,
            rootPane: updateWindowTitle(
              tab.rootPane,
              msg.sessionId as string,
              msg.title
            ),
          }))
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

  // Get active tab
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // For title bar, extract tab info with process name from focused pane
  const titleBarTabs = tabs.map((tab) => {
    const focusedPaneInTab = findPaneById(tab.rootPane, tab.focusedPaneId);
    const terminalPane =
      focusedPaneInTab && isTerminalPane(focusedPaneInTab)
        ? focusedPaneInTab
        : getFirstTerminalPane(tab.rootPane);
    // Tab has multiple panes if rootPane is not a terminal pane (i.e., it's a split)
    const hasMultiplePanes = !isTerminalPane(tab.rootPane);
    // Check if ANY pane in this tab has MCP attached
    const allPanes = getAllTerminalPanes(tab.rootPane);
    const hasMcpSession = mcpAttachedSessionId !== null &&
      allPanes.some((p) => p.sessionId === mcpAttachedSessionId);
    // Check if the FOCUSED pane has MCP attached
    const focusedPaneHasMcp = terminalPane?.sessionId === mcpAttachedSessionId;
    return {
      id: tab.id,
      title: tab.title,
      sessionId: terminalPane?.sessionId || "",
      processName: terminalPane?.processName || "shell",
      windowTitle: terminalPane?.windowTitle,
      isSandboxed: terminalPane?.isSandboxed || false,
      sandboxConfig: terminalPane?.sandboxConfig,
      hasMultiplePanes,
      hasMcpSession,
      focusedPaneHasMcp,
    };
  });

  // Check if we have exactly one terminal (one tab with a single terminal pane, not split)
  const isSingleTerminal = tabs.length === 1 && activeTab && isTerminalPane(activeTab.rootPane);

  // Project name for Claude button (basename of CWD, null when in home/root directory)
  const claudeProjectName = (() => {
    if (!focusedCwd) return null;
    const homedir = homedirRef.current;
    if (focusedCwd === '/' || focusedCwd === homedir) return null;
    return focusedCwd.split('/').pop() ?? null;
  })();

  // Whether the focused terminal is inside a git project
  const claudeProjectIsGit = !!(projectRoot && focusedCwd?.startsWith(projectRoot));

  // Find which tab has the MCP-attached session
  const mcpTab = tabs.find((tab) => {
    const terminals = getAllTerminalPanes(tab.rootPane);
    return terminals.some((t) => t.sessionId === mcpAttachedSessionId);
  });

  // Alias for status bar and Claude panel props
  const focusedSessionId = currentFocusedSessionId;

  // Render error state (only if no tabs and no modal)
  if (error && tabs.length === 0 && !showModeModal) {
    return (
      <div className="app app-error">
        <div className="error-icon">!</div>
        <h2>Failed to start terminal</h2>
        <p>{error}</p>
        <button
          onClick={() => {
            setError(null);
            requestNewTab();
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
          tabs={titleBarTabs}
          activeTabId={activeTabId}
          mcpAttachedSessionId={mcpAttachedSessionId}
          isSingleTerminal={!!isSingleTerminal}
          onTabSelect={selectTab}
          onTabClose={closeTab}
          onNewTab={requestNewTab}
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
        {showFindBar && activeTabId && (
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
        {tabs.map((tab) => {
          const editorActive = !!(activeSidebarPlugin && editorFile);
          const hideTerminals = editorActive && showClaudePanel;

          return (
          <div
            key={tab.id}
            className={`terminal-wrapper ${hideTerminals ? "hidden" : (tab.id === activeTabId ? "visible" : "hidden")}`}
            style={{
              left: editorActive && !showClaudePanel
                ? `calc(${sidebarWidth}px + (100% - ${sidebarWidth}px) / 2)`
                : sidebarWidth,
              right: showClaudePanel ? claudePanelWidth : 0,
            }}
          >
            <PaneContainer
              pane={tab.rootPane}
              focusedPaneId={tab.focusedPaneId}
              isTabVisible={tab.id === activeTabId}
              mcpAttachedSessionId={mcpAttachedSessionId}
              isSinglePane={isTerminalPane(tab.rootPane)}
              hideHeader={!!isSingleTerminal && tab.id === activeTabId && isMac}
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
        })}
        {tabs.length === 0 && !showModeModal && !showWelcomeModal && welcomeCheckComplete && (
          <div className="no-tabs">
            <p>No terminals open</p>
            <button onClick={requestNewTab}>New Terminal</button>
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
