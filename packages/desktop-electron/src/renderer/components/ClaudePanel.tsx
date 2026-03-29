/**
 * Claude Code Side Panel Component
 *
 * Right-side panel that hosts Claude Code CLI sessions with tab support.
 * Layer 0: Single tab (no tab bar visible) — identical to original behavior.
 * Layer 1: Multiple tabs with tab bar — one per worktree or directory.
 *
 * Tabs stay mounted (display:none when inactive) to preserve terminal state.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { ClaudeTabContent } from "./ClaudeTabContent";
import { ClaudeTabBar } from "./ClaudeTabBar";
import { ClaudeWorktreePicker } from "./ClaudeWorktreePicker";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import type { ClaudeTab, GitWorktree, PersistedClaudeTab } from "../types/claude-tab";

/** Extract a display-friendly version string: "2.1.41 (Claude Code)" → "v2.1.41" */
function formatVersion(raw: string): string {
  const match = raw.match(/[\d]+\.[\d]+\.[\d]+/);
  return match ? `v${match[0]}` : raw;
}

/** Generate a unique tab ID */
function genTabId(): string {
  return `ct-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const STORAGE_KEY = "claudeTabs";

/** Load persisted tabs from localStorage */
function loadPersistedTabs(): PersistedClaudeTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save tab metadata to localStorage */
function persistTabs(tabs: ClaudeTab[]) {
  const data: PersistedClaudeTab[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    cwd: t.cwd,
    worktreeName: t.worktreeName,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

interface ClaudePanelProps {
  /** Active tab's session ID (backwards-compat with App.tsx handleAddToChat) */
  sessionId: string | null;
  onSessionCreated: (sessionId: string | null) => void;
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
  visible: boolean;
  getCwd: () => Promise<string | undefined>;
  projectName?: string | null;
  /** Session ID of the terminal pane that was focused when the panel opened */
  focusedSessionId: string | null;
}

export function ClaudePanel({
  sessionId: _legacySessionId,
  onSessionCreated,
  width,
  onResize,
  onClose,
  visible,
  getCwd,
  projectName,
  focusedSessionId,
}: ClaudePanelProps) {
  const [claudeInfo, setClaudeInfo] = useState<{ model: string | null; version: string | null }>({
    model: null,
    version: null,
  });
  // Sticky project name: captured at launch time so it doesn't change when the user switches terminal panes
  const [stickyProjectName, setStickyProjectName] = useState<string | null>(null);
  const prevVisibleRef = useRef(visible);

  // --- Tab state ---
  const [tabs, setTabs] = useState<ClaudeTab[]>(() => {
    // Restore persisted tabs (sessions will re-launch on mount)
    const persisted = loadPersistedTabs();
    if (persisted.length > 0) {
      return persisted.map((p) => ({
        ...p,
        // Clear persisted CWD for non-worktree tabs so that getCwd() resolves
        // the live terminal directory at launch time instead of using a stale path.
        cwd: p.worktreeName ? p.cwd : "",
        sessionId: null,
        createdAt: Date.now(),
        exited: false,
      }));
    }
    // Default: single tab for current directory
    return [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const persisted = loadPersistedTabs();
    return persisted.length > 0 ? persisted[0].id : null;
  });

  // Create initial tab on first open if none exist
  useEffect(() => {
    if (tabs.length > 0) return;
    if (!visible) return;

    const createInitialTab = async () => {
      const cwd = await getCwd();
      const label = cwd?.split("/").pop() ?? "Claude";
      const id = genTabId();
      const tab: ClaudeTab = {
        id,
        sessionId: null,
        label,
        cwd: cwd ?? "",
        createdAt: Date.now(),
        exited: false,
      };
      setTabs([tab]);
      setActiveTabId(id);
      // Capture sticky project name
      if (cwd) {
        const homedir = await window.terminalAPI.getHomedir();
        if (cwd !== "/" && cwd !== homedir) {
          setStickyProjectName(cwd.split("/").pop() ?? null);
        }
      }
    };
    createInitialTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Persist tabs when they change
  useEffect(() => {
    if (tabs.length > 0) {
      persistTabs(tabs);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [tabs]);

  // Fetch Claude info on mount and listen for changes
  useEffect(() => {
    window.terminalAPI.claudeGetInfo().then(setClaudeInfo);
    const cleanup = window.terminalAPI.onClaudeInfoChanged(setClaudeInfo);
    return cleanup;
  }, []);

  // Detect when panel is reopened from a terminal with a different CWD (single-tab only)
  useEffect(() => {
    const wasHidden = !prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (!visible || !wasHidden) return;

    // Update sticky project name when panel becomes visible
    getCwd().then(async (cwd) => {
      if (!cwd) return;
      const homedir = await window.terminalAPI.getHomedir();
      if (cwd !== "/" && cwd !== homedir) {
        setStickyProjectName(cwd.split("/").pop() ?? null);
      }
    });
  }, [visible, getCwd]);

  // Sync active tab's sessionId back to App.tsx for handleAddToChat
  const activeTab = tabs.find((t) => t.id === activeTabId);
  useEffect(() => {
    onSessionCreated(activeTab?.sessionId ?? null);
  }, [activeTab?.sessionId, onSessionCreated]);

  // --- Tab callbacks ---

  const handleTabSessionCreated = useCallback(
    (tabId: string, newSessionId: string | null) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, sessionId: newSessionId } : t))
      );
    },
    []
  );

  const handleTabSessionExited = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const updated = prev.map((t) =>
          t.id === tabId ? { ...t, exited: true, sessionId: null } : t
        );
        // If only one tab and it exited, close the panel
        if (updated.length === 1 && updated[0].exited) {
          // Clear persisted tabs and close
          localStorage.removeItem(STORAGE_KEY);
          setTimeout(() => onClose(), 0);
          return [];
        }
        return updated;
      });
    },
    [onClose]
  );

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      // Extract session ID and kill outside the state updater to avoid
      // side effects running twice in React Strict Mode.
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (tab?.sessionId) {
          const sid = tab.sessionId;
          // Schedule IPC outside updater via microtask
          queueMicrotask(() => {
            window.terminalAPI.input(sid, "\x03");
            setTimeout(() => window.terminalAPI.input(sid, "exit\n"), 100);
          });
        }

        const remaining = prev.filter((t) => t.id !== tabId);

        if (remaining.length === 0) {
          localStorage.removeItem(STORAGE_KEY);
          setTimeout(() => onClose(), 0);
          return [];
        }

        // If we closed the active tab, switch to the nearest one
        if (tabId === activeTabId) {
          const closedIdx = prev.findIndex((t) => t.id === tabId);
          const newActive = remaining[Math.min(closedIdx, remaining.length - 1)];
          setActiveTabId(newActive.id);
        }

        return remaining;
      });
    },
    [activeTabId, onClose]
  );

  const handleAddTab = useCallback(
    async (worktree?: GitWorktree) => {
      let cwd: string;
      let label: string;
      let worktreeName: string | undefined;

      if (worktree) {
        cwd = worktree.path;
        label = worktree.branch ?? worktree.path.split("/").pop() ?? "worktree";
        worktreeName = worktree.branch ?? undefined;
      } else {
        const resolved = await getCwd();
        cwd = resolved ?? "";
        label = cwd.split("/").pop() ?? "Claude";
      }

      const id = genTabId();
      const tab: ClaudeTab = {
        id,
        sessionId: null,
        label,
        cwd,
        worktreeName,
        createdAt: Date.now(),
        exited: false,
      };

      setTabs((prev) => [...prev, tab]);
      setActiveTabId(id);
    },
    [getCwd]
  );

  // Resize handle
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = startWidth - (ev.clientX - startX);
        onResize(newWidth);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onResize]
  );

  // Use sticky name (captured at launch), fall back to live prop (pre-launch)
  const displayName = stickyProjectName ?? projectName;
  const showTabBar = tabs.length > 1;

  return (
    <div className="claude-panel" style={{ width, display: visible ? undefined : "none" }}>
      <div className="claude-panel-resize-handle" onMouseDown={handleResizeMouseDown} />
      <div className="claude-panel-header">
        <div className="claude-panel-header-title">
          <ClaudeIcon size={14} />
          <span>
            Claude Code{displayName ? <> — <strong>{displayName}</strong></> : ""}
          </span>
        </div>
        <div className="claude-panel-header-spacer" />
        <ClaudeWorktreePicker
          tabs={tabs}
          onAddTab={handleAddTab}
          buttonClassName="claude-panel-header-add"
          currentCwd={activeTab?.cwd}
        />
        <div className="claude-panel-header-right">
          {claudeInfo.model && (
            <span className="claude-panel-model-pill">{claudeInfo.model}</span>
          )}
          {claudeInfo.version && (
            <span className="claude-panel-version">{formatVersion(claudeInfo.version)}</span>
          )}
          <button
            className="claude-panel-close"
            onClick={onClose}
            title="Close panel"
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      {showTabBar && (
        <ClaudeTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onAddTab={handleAddTab}
        />
      )}
      <div className="claude-panel-tabs-content">
        {tabs.map((tab) => (
          <ClaudeTabContent
            key={tab.id}
            sessionId={tab.sessionId}
            onSessionCreated={(sid) => handleTabSessionCreated(tab.id, sid)}
            onSessionExited={() => handleTabSessionExited(tab.id)}
            width={width}
            isVisible={tab.id === activeTabId}
            getCwd={getCwd}
            overrideCwd={tab.cwd || undefined}
            focusedSessionId={focusedSessionId}
          />
        ))}
      </div>
    </div>
  );
}
