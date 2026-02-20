/**
 * Title Bar Component
 *
 * Unified title bar on macOS. Provides draggable area
 * and shows centered process name with status indicators.
 * When there's a single terminal pane (no splits), shows
 * full status badges in the title bar instead of the pane header.
 */

import { useMemo } from "react";
import { getProcessIcon, getProcessDisplayName } from "../utils/processIcons";
import { McpIcon, SandboxIcon } from "./icons";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { StatusBadge } from "./StatusBadge";
import { MoreMenu } from "./MoreMenu";
import type { MoreMenuItem } from "./MoreMenu";
import type { PaneSandboxConfig } from "../types/pane";

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

export interface PaneInfo {
  sessionId: string;
  processName: string;
  windowTitle?: string;
  isSandboxed: boolean;
  sandboxConfig?: PaneSandboxConfig;
  hasMultiplePanes: boolean;
  hasMcpSession: boolean;
  focusedPaneHasMcp: boolean;
}

interface TitleBarProps {
  paneInfo: PaneInfo | null;
  mcpAttachedSessionId: string | null;
  isSingleTerminal: boolean;
  onOpenSettings?: () => void;
  onMcpToggle?: (sessionId: string) => void;
  onSandboxClick?: (config: PaneSandboxConfig) => void;
  onClaudeToggle?: () => void;
  claudePanelOpen?: boolean;
  claudeProjectName?: string | null;
  claudeProjectIsGit?: boolean;
}

export function TitleBar({
  paneInfo,
  mcpAttachedSessionId,
  isSingleTerminal,
  onOpenSettings,
  onMcpToggle,
  onSandboxClick,
  onClaudeToggle,
  claudePanelOpen = false,
  claudeProjectName,
  claudeProjectIsGit = false,
}: TitleBarProps) {
  // Build MoreMenu items based on context
  const moreMenuItems = useMemo(() => {
    const items: MoreMenuItem[] = [];
    if (isSingleTerminal && paneInfo && onMcpToggle) {
      items.push({
        id: "mcp",
        label: paneInfo.hasMcpSession ? "Disable MCP for this Terminal" : "Access this Terminal via MCP",
        icon: <McpIcon isActive={paneInfo.hasMcpSession} size={14} />,
        indicator: "mcp",
        indicatorActive: paneInfo.hasMcpSession,
        onClick: () => onMcpToggle(paneInfo.sessionId),
      });
    }
    if (onOpenSettings) {
      items.push({
        id: "settings",
        label: "Settings",
        icon: <span style={{ fontSize: 16, lineHeight: 1 }}>⚙</span>,
        shortcut: isMac ? "\u2318," : "Ctrl+,",
        onClick: () => onOpenSettings(),
      });
    }
    return items;
  }, [isSingleTerminal, paneInfo, onMcpToggle, onOpenSettings]);

  return (
    <div className="title-bar">
      <div className="title-bar-row">
        <div className="title-bar-spacer" />

        <div className="title-bar-tabs">
          {paneInfo ? (
            <div className={`title-bar-single ${isSingleTerminal ? 'title-bar-single-merged' : ''}`}>
              <div className="title-bar-single-title">
                <span className="title-bar-single-icon">
                  {getProcessIcon(paneInfo.processName)}
                </span>
                <span className="title-bar-single-name">
                  {paneInfo.windowTitle || getProcessDisplayName(paneInfo.processName)}
                </span>
                {paneInfo.hasMcpSession && <McpIcon isActive={true} size={12} />}
              </div>
              {isSingleTerminal ? (
                // Sandbox badge only — MCP is now in the MoreMenu
                <div className="title-bar-single-badges">
                  {paneInfo.isSandboxed && (
                    <StatusBadge
                      icon={<SandboxIcon size={12} />}
                      label="Sandboxed"
                      variant="sandbox"
                      onClick={paneInfo.sandboxConfig && onSandboxClick ? () => onSandboxClick(paneInfo.sandboxConfig!) : undefined}
                    />
                  )}
                </div>
              ) : (
                // Multiple panes - show MCP only if focused pane has it
                <span className="title-bar-single-status">
                  {paneInfo.isSandboxed && <SandboxIcon size={12} className="title-bar-single-sandbox" />}
                  {paneInfo.focusedPaneHasMcp && (
                    <span className="title-tab-mcp-label">
                      <McpIcon isActive={true} size={12} />
                      <span>MCP</span>
                    </span>
                  )}
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Claude Code button - visible when in a project, hidden when panel is open */}
        {onClaudeToggle && claudeProjectName && !claudePanelOpen && (
          <button
            className="title-bar-claude"
            onClick={(e) => { e.preventDefault(); onClaudeToggle(); }}
            title={`Toggle Claude Code panel (Cmd+Shift+A) — ${claudeProjectName}`}
          >
            <ClaudeIcon size={19} />
            {claudeProjectIsGit
              ? <span className="title-bar-claude-label title-bar-claude-label-git">{claudeProjectName}</span>
              : <span className="title-bar-claude-label">/{claudeProjectName}</span>
            }
          </button>
        )}
        {/* More menu (MCP + Settings) */}
        {moreMenuItems.length > 0 && (
          <MoreMenu items={moreMenuItems} size="titlebar" />
        )}
      </div>
    </div>
  );
}
