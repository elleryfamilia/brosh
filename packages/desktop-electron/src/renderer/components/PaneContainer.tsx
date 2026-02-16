/**
 * Pane Container Component
 *
 * Recursively renders the pane tree.
 * Renders TerminalPane for terminal nodes, PendingPaneView for pending nodes,
 * and SplitContainer for split nodes.
 */

import type { Pane, PaneSandboxConfig } from "../types/pane";
import { isTerminalPane, isPendingPane, isSplitPane } from "../types/pane";
import { TerminalPane } from "./TerminalPane";
import type { TerminalMethods } from "./Terminal";
import { PendingPaneView } from "./PendingPaneView";
import { SplitContainer } from "./SplitContainer";
import type { SandboxConfig } from "../types/sandbox";
import type { ErrorNotification } from "./ErrorNotificationBar";

interface PaneContainerProps {
  pane: Pane;
  focusedPaneId: string;
  isTabVisible: boolean;
  mcpAttachedSessionId: string | null;
  isSinglePane: boolean;
  hideHeader?: boolean;
  onFocus: (paneId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSplitRatioChange: (splitPaneId: string, newRatio: number) => void;
  onPendingModeSelected: (
    paneId: string,
    mode: "direct" | "sandbox",
    config?: SandboxConfig
  ) => void;
  onPendingCancel: (paneId: string) => void;
  onOpenSettings?: () => void;
  onMcpToggle?: (sessionId: string) => void;
  onSandboxClick?: (config: PaneSandboxConfig) => void;
  onClaudeToggle?: () => void;
  claudePanelOpen?: boolean;
  claudeProjectName?: string | null;
  claudeProjectIsGit?: boolean;
  onContextMenu?: (e: React.MouseEvent, methods: TerminalMethods, sessionId: string) => void;
  onTerminalMethodsReady?: (paneId: string, methods: TerminalMethods | null) => void;
  onFileLink?: (filePath: string, isDiff: boolean) => void;
  onAddToChat?: (sessionId: string, text: string) => void;
  errorNotifications?: Map<string, ErrorNotification>;
  onDismissError?: (sessionId: string) => void;
}

export function PaneContainer({
  pane,
  focusedPaneId,
  isTabVisible,
  mcpAttachedSessionId,
  isSinglePane,
  hideHeader = false,
  onFocus,
  onSessionClose,
  onSplitRatioChange,
  onPendingModeSelected,
  onPendingCancel,
  onOpenSettings,
  onMcpToggle,
  onSandboxClick,
  onClaudeToggle,
  claudePanelOpen,
  claudeProjectName,
  claudeProjectIsGit,
  onContextMenu,
  onTerminalMethodsReady,
  onFileLink,
  onAddToChat,
  errorNotifications,
  onDismissError,
}: PaneContainerProps) {
  if (isTerminalPane(pane)) {
    const hasMcp = pane.sessionId === mcpAttachedSessionId;
    // Show close button only when there are multiple panes (not single pane mode)
    const showCloseButton = !isSinglePane && !hideHeader;
    return (
      <TerminalPane
        paneId={pane.id}
        sessionId={pane.sessionId}
        processName={pane.processName}
        windowTitle={pane.windowTitle}
        isFocused={pane.id === focusedPaneId}
        isVisible={isTabVisible}
        hasMcp={hasMcp}
        isSandboxed={pane.isSandboxed}
        sandboxConfig={pane.sandboxConfig}
        showHeader={!hideHeader}
        showCloseButton={showCloseButton}
        onFocus={onFocus}
        onSessionClose={onSessionClose}
        onOpenSettings={onOpenSettings}
        onMcpToggle={onMcpToggle ? () => onMcpToggle(pane.sessionId) : undefined}
        onSandboxClick={onSandboxClick && pane.sandboxConfig ? () => onSandboxClick(pane.sandboxConfig!) : undefined}
        onClaudeToggle={onClaudeToggle}
        claudePanelOpen={claudePanelOpen}
        claudeProjectName={claudeProjectName}
        claudeProjectIsGit={claudeProjectIsGit}
        onClose={() => onSessionClose(pane.sessionId)}
        onContextMenu={onContextMenu ? (e, methods) => onContextMenu(e, methods, pane.sessionId) : undefined}
        onTerminalMethodsReady={onTerminalMethodsReady}
        onFileLink={onFileLink}
        onAddToChat={onAddToChat}
        errorNotification={errorNotifications?.get(pane.sessionId)}
        onDismissError={onDismissError}
      />
    );
  }

  if (isPendingPane(pane)) {
    return (
      <PendingPaneView
        paneId={pane.id}
        onModeSelected={onPendingModeSelected}
        onCancel={onPendingCancel}
      />
    );
  }

  if (isSplitPane(pane)) {
    return (
      <SplitContainer
        id={pane.id}
        direction={pane.direction}
        splitRatio={pane.splitRatio}
        onRatioChange={onSplitRatioChange}
        first={
          <PaneContainer
            pane={pane.first}
            focusedPaneId={focusedPaneId}
            isTabVisible={isTabVisible}
            mcpAttachedSessionId={mcpAttachedSessionId}
            isSinglePane={false}
            onFocus={onFocus}
            onSessionClose={onSessionClose}
            onSplitRatioChange={onSplitRatioChange}
            onPendingModeSelected={onPendingModeSelected}
            onPendingCancel={onPendingCancel}
            onOpenSettings={onOpenSettings}
            onMcpToggle={onMcpToggle}
            onSandboxClick={onSandboxClick}
            onClaudeToggle={onClaudeToggle}
            claudePanelOpen={claudePanelOpen}
            claudeProjectName={claudeProjectName}
            claudeProjectIsGit={claudeProjectIsGit}
            onContextMenu={onContextMenu}
            onTerminalMethodsReady={onTerminalMethodsReady}
            onFileLink={onFileLink}
            onAddToChat={onAddToChat}
            errorNotifications={errorNotifications}
            onDismissError={onDismissError}
          />
        }
        second={
          <PaneContainer
            pane={pane.second}
            focusedPaneId={focusedPaneId}
            isTabVisible={isTabVisible}
            mcpAttachedSessionId={mcpAttachedSessionId}
            isSinglePane={false}
            onFocus={onFocus}
            onSessionClose={onSessionClose}
            onSplitRatioChange={onSplitRatioChange}
            onPendingModeSelected={onPendingModeSelected}
            onPendingCancel={onPendingCancel}
            onOpenSettings={onOpenSettings}
            onMcpToggle={onMcpToggle}
            onSandboxClick={onSandboxClick}
            onClaudeToggle={onClaudeToggle}
            claudePanelOpen={claudePanelOpen}
            claudeProjectName={claudeProjectName}
            claudeProjectIsGit={claudeProjectIsGit}
            onContextMenu={onContextMenu}
            onTerminalMethodsReady={onTerminalMethodsReady}
            onFileLink={onFileLink}
            onAddToChat={onAddToChat}
            errorNotifications={errorNotifications}
            onDismissError={onDismissError}
          />
        }
      />
    );
  }

  return null;
}
