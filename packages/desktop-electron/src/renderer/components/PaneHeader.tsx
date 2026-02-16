/**
 * Pane Header Component
 *
 * A header bar (~28px) showing process icon and name.
 * Displays status badges with labels for sandbox, MCP, and recording.
 * MCP badge is clickable to toggle MCP attachment.
 * Sandbox badge is clickable to show sandbox settings.
 * Recording badge toggles terminal recording.
 * Has green-tinted background when MCP is active.
 */

import { useMemo } from "react";
import {
  getProcessIcon,
  getProcessDisplayName,
} from "../utils/processIcons";
import { McpIcon, SandboxIcon } from "./icons";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { StatusBadge } from "./StatusBadge";
import { MoreMenu } from "./MoreMenu";
import type { MoreMenuItem } from "./MoreMenu";
import type { PaneSandboxConfig } from "../types/pane";

interface PaneHeaderProps {
  processName: string;
  windowTitle?: string;
  isFocused: boolean;
  hasMcp?: boolean;
  isSandboxed?: boolean;
  sandboxConfig?: PaneSandboxConfig;
  showCloseButton?: boolean;
  onMcpToggle?: () => void;
  onSandboxClick?: () => void;
  onClose?: () => void;
  onOpenSettings?: () => void;
  onClaudeToggle?: () => void;
  claudePanelOpen?: boolean;
  claudeProjectName?: string | null;
  claudeProjectIsGit?: boolean;
}

export function PaneHeader({
  processName,
  windowTitle,
  isFocused,
  hasMcp = false,
  isSandboxed = false,
  sandboxConfig,
  showCloseButton = false,
  onMcpToggle,
  onSandboxClick,
  onClose,
  onOpenSettings,
  onClaudeToggle,
  claudePanelOpen = false,
  claudeProjectName,
  claudeProjectIsGit = false,
}: PaneHeaderProps) {
  // Icon is always derived from the actual PTY process
  const icon = getProcessIcon(processName);
  // Display text: use windowTitle if set, otherwise the process display name
  const displayName = windowTitle || getProcessDisplayName(processName);

  const headerClasses = [
    "pane-header",
    isFocused ? "pane-header-focused" : "",
    hasMcp ? "pane-header-mcp" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Build MoreMenu items
  const moreMenuItems = useMemo(() => {
    const items: MoreMenuItem[] = [];
    if (onMcpToggle) {
      items.push({
        id: "mcp",
        label: hasMcp ? "Disable MCP for this Terminal" : "Access this Terminal via MCP",
        icon: <McpIcon isActive={hasMcp} size={14} />,
        indicator: "mcp",
        indicatorActive: hasMcp,
        onClick: onMcpToggle,
      });
    }
    if (onOpenSettings) {
      items.push({
        id: "settings",
        label: "Settings",
        icon: <span style={{ fontSize: 14, lineHeight: 1 }}>⚙</span>,
        onClick: onOpenSettings,
      });
    }
    return items;
  }, [hasMcp, onMcpToggle, onOpenSettings]);

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };

  return (
    <div className={headerClasses}>
      {showCloseButton && (
        <button
          className="pane-header-close"
          onClick={handleCloseClick}
          title="Close pane"
          type="button"
        >
          ×
        </button>
      )}
      <span className="pane-header-icon">{icon}</span>
      <span className="pane-header-name">{displayName}</span>
      {hasMcp && <McpIcon isActive={true} size={11} />}
      <div className="pane-header-badges">
        {isSandboxed && (
          <StatusBadge
            icon={<SandboxIcon size={12} />}
            label="Sandboxed"
            variant="sandbox"
            onClick={sandboxConfig ? onSandboxClick : undefined}
          />
        )}
        {moreMenuItems.length > 0 && (
          <MoreMenu items={moreMenuItems} size="pane" />
        )}
      </div>
      {onClaudeToggle && claudeProjectName && !claudePanelOpen && (
        <button
          className="pane-header-claude"
          onClick={(e) => { e.stopPropagation(); onClaudeToggle(); }}
          title={`Toggle Claude Code panel (Ctrl+Shift+A) — ${claudeProjectName}`}
          type="button"
        >
          <ClaudeIcon size={16} />
          {claudeProjectIsGit
            ? <span className="pane-header-claude-label pane-header-claude-label-git">{claudeProjectName}</span>
            : <span className="pane-header-claude-label">/{claudeProjectName}</span>
          }
        </button>
      )}
    </div>
  );
}
