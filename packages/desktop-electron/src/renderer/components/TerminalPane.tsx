/**
 * Terminal Pane Component
 *
 * Wraps a Terminal with a header bar and focus indicator.
 */

import { useCallback, useState, useRef, useEffect } from "react";
import { Terminal } from "./Terminal";
import type { TerminalMethods, InputMode } from "./Terminal";
import { PaneHeader } from "./PaneHeader";
import { ErrorNotificationBar } from "./ErrorNotificationBar";
import type { ErrorNotification } from "./ErrorNotificationBar";
import type { PaneSandboxConfig } from "../types/pane";

interface TerminalPaneProps {
  paneId: string;
  sessionId: string;
  processName: string;
  windowTitle?: string;
  isFocused: boolean;
  isVisible: boolean;
  hasMcp: boolean;
  isSandboxed: boolean;
  sandboxConfig?: PaneSandboxConfig;
  showHeader: boolean;
  showCloseButton?: boolean;
  onFocus: (paneId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onMcpToggle?: () => void;
  onSandboxClick?: () => void;
  onClose?: () => void;
  onOpenSettings?: () => void;
  onClaudeToggle?: () => void;
  claudePanelOpen?: boolean;
  claudeProjectName?: string | null;
  claudeProjectIsGit?: boolean;
  onContextMenu?: (e: React.MouseEvent, methods: TerminalMethods) => void;
  onTerminalMethodsReady?: (paneId: string, methods: TerminalMethods | null) => void;
  onFileLink?: (filePath: string, isDiff: boolean) => void;
  onAddToChat?: (sessionId: string, text: string) => void;
  errorNotification?: ErrorNotification;
  onDismissError?: (sessionId: string) => void;
}

export function TerminalPane({
  paneId,
  sessionId,
  processName,
  windowTitle,
  isFocused,
  isVisible,
  hasMcp,
  isSandboxed,
  sandboxConfig,
  showHeader,
  showCloseButton = false,
  onFocus,
  onSessionClose,
  onMcpToggle,
  onSandboxClick,
  onClose,
  onOpenSettings,
  onClaudeToggle,
  claudePanelOpen,
  claudeProjectName,
  claudeProjectIsGit,
  onContextMenu,
  onTerminalMethodsReady,
  onFileLink,
  onAddToChat,
  errorNotification,
  onDismissError,
}: TerminalPaneProps) {
  // Track terminal methods for search/find
  const terminalMethodsRef = useRef<TerminalMethods | null>(null);

  const handleClick = useCallback(() => {
    onFocus(paneId);
  }, [paneId, onFocus]);

  const handleClose = useCallback(() => {
    onSessionClose(sessionId);
  }, [sessionId, onSessionClose]);

  const handleTerminalFocus = useCallback(() => {
    onFocus(paneId);
  }, [paneId, onFocus]);

  // Handle terminal methods when ready - store and notify parent if focused
  const handleMethodsReady = useCallback(
    (methods: TerminalMethods) => {
      terminalMethodsRef.current = methods;
      if (isFocused && onTerminalMethodsReady) {
        onTerminalMethodsReady(paneId, methods);
      }
    },
    [isFocused, paneId, onTerminalMethodsReady]
  );

  // Notify parent of terminal methods when this pane becomes focused
  useEffect(() => {
    if (isFocused && terminalMethodsRef.current && onTerminalMethodsReady) {
      onTerminalMethodsReady(paneId, terminalMethodsRef.current);
    }
  }, [isFocused, paneId, onTerminalMethodsReady]);

  // Track input mode for visual feedback
  const [inputMode, setInputMode] = useState<InputMode>(null);

  const handleInputModeChange = useCallback((mode: InputMode) => {
    setInputMode(mode);
  }, []);

  // Build class names for the pane
  const paneClasses = [
    "terminal-pane",
    isFocused && showHeader ? "terminal-pane-focused" : "",
    inputMode === "AI" ? "input-mode-ai" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={paneClasses}
      onClick={handleClick}
    >
      {showHeader && (
        <PaneHeader
          processName={processName}
          windowTitle={windowTitle}
          isFocused={isFocused}
          hasMcp={hasMcp}
          isSandboxed={isSandboxed}
          sandboxConfig={sandboxConfig}
          showCloseButton={showCloseButton}
          onMcpToggle={onMcpToggle}
          onSandboxClick={onSandboxClick}
          onClose={onClose}
          onOpenSettings={onOpenSettings}
          onClaudeToggle={onClaudeToggle}
          claudePanelOpen={claudePanelOpen}
          claudeProjectName={claudeProjectName}
          claudeProjectIsGit={claudeProjectIsGit}
        />
      )}
      <div className="terminal-pane-content">
        <Terminal
          sessionId={sessionId}
          onClose={handleClose}
          isVisible={isVisible}
          isFocused={isFocused}
          onFocus={handleTerminalFocus}
          onContextMenu={onContextMenu}
          onInputModeChange={handleInputModeChange}
          onMethodsReady={handleMethodsReady}
          onFileLink={onFileLink}
          onAddToChat={onAddToChat}
        />
        {errorNotification && onDismissError && (
          <ErrorNotificationBar
            notification={errorNotification}
            onDismiss={onDismissError}
          />
        )}
      </div>
    </div>
  );
}
