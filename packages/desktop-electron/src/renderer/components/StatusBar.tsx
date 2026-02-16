/**
 * Status Bar Component
 *
 * Displays status information at the bottom of the terminal window.
 * Shows Claude status indicator on the right side.
 */

import { useEffect, useState, useCallback } from "react";
import type { ClaudeStatus } from "../types/electron";
import type { ClaudeModel } from "../settings/types";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { ModelSelector } from "./ModelSelector";

interface StatusBarProps {
  sessionId: string | null;
  isRecording: boolean;
  isConnected: boolean;
  mcpAttachedSessionId: string | null;
  activeTabTitle: string | null;
}

export function StatusBar({
  sessionId,
  isRecording,
  isConnected,
  mcpAttachedSessionId,
  activeTabTitle,
}: StatusBarProps) {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [modelSelectorPosition, setModelSelectorPosition] = useState({ x: 0, y: 0 });

  // Fetch Claude status
  useEffect(() => {
    window.terminalAPI.getClaudeStatus().then(setClaudeStatus).catch(console.error);
  }, []);

  // Handle Claude indicator click
  const handleClaudeClick = useCallback((e: React.MouseEvent) => {
    if (!claudeStatus?.authenticated) {
      // Show login prompt for unauthenticated state
      return;
    }
    setModelSelectorPosition({ x: e.clientX, y: e.clientY });
    setShowModelSelector(true);
  }, [claudeStatus?.authenticated]);

  // Handle model change
  const handleModelChange = useCallback(async (model: ClaudeModel) => {
    try {
      await window.terminalAPI.setClaudeModel(model);
      // Refresh status to get updated model
      const status = await window.terminalAPI.getClaudeStatus();
      setClaudeStatus(status);
    } catch (err) {
      console.error('Failed to change model:', err);
    }
  }, []);

  // Close model selector
  const handleCloseModelSelector = useCallback(() => {
    setShowModelSelector(false);
  }, []);

  return (
    <>
      <div className="status-bar">
        <div className="status-bar-left">
          {/* Recording indicator */}
          {isRecording && (
            <span className="status-indicator recording">
              <span className="recording-dot" />
              Recording
            </span>
          )}
        </div>

        <div className="status-bar-center">
          {/* Empty for now */}
        </div>

        <div className="status-bar-right">
          {/* Claude status indicator */}
          {claudeStatus?.installed && (
            <button
              className={`status-bar-claude ${
                claudeStatus.authenticated
                  ? "status-bar-claude-authenticated"
                  : "status-bar-claude-warning"
              }`}
              onClick={handleClaudeClick}
              title={
                claudeStatus.authenticated
                  ? `Claude Code (${claudeStatus.model || "haiku"}) - Click to change model`
                  : "Claude Code not authenticated - Run `claude login` to authenticate"
              }
            >
              <ClaudeIcon size={14} />
              <span>
                {claudeStatus.authenticated
                  ? `Claude (${claudeStatus.model || "haiku"})`
                  : "Claude"}
              </span>
              {!claudeStatus.authenticated && (
                <span className="status-bar-warning-icon">{"\u26A0"}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Model selector dropdown */}
      {showModelSelector && claudeStatus?.authenticated && (
        <ModelSelector
          currentModel={(claudeStatus.model as ClaudeModel) || "haiku"}
          onModelChange={handleModelChange}
          onClose={handleCloseModelSelector}
          position={modelSelectorPosition}
        />
      )}
    </>
  );
}
