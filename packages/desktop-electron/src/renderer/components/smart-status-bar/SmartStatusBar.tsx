/**
 * SmartStatusBar Component
 *
 * Fixed-height status bar that replaces the expandable MCP dashboard.
 * Shows contextual badges that appear when relevant.
 * Plugin badges are rendered dynamically from the plugin registry.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ClaudeStatus } from '../../types/electron.d';
import type { EnvironmentInfo } from './types';
import { useEnhancedClients } from '../mcp-dashboard/useEnhancedClients';
import { getPlugins } from '../../plugins/registry';
import type { WorkspaceContext } from '../../plugins/types';

// Badges
import { McpBadge } from './badges/McpBadge';
import { ContinueInClaudeBadge } from './badges/ContinueInClaudeBadge';
import { ErrorBadge } from './badges/ErrorBadge';
import { EnvironmentBadge } from './badges/EnvironmentBadge';
import { PortBadge } from './badges/PortBadge';
import { FeedbackBadge } from './badges/FeedbackBadge';

// Modals
import { McpModal } from './modals/McpModal';
import { ErrorModal } from './modals/ErrorModal';
import { FeedbackModal } from './modals/FeedbackModal';


export interface SmartStatusBarProps {
  mcpAttachedSessionId: string | null;
  focusedSessionId: string | null;
  claudeSessionId: string | null;
  workspace: WorkspaceContext;
  activeSidebarPlugin: string | null;
  onTogglePlugin: (pluginId: string) => void;
  onShowMcpInstructions: () => void;
}

export function SmartStatusBar({
  mcpAttachedSessionId,
  focusedSessionId,
  claudeSessionId,
  workspace,
  activeSidebarPlugin,
  onTogglePlugin,
  onShowMcpInstructions,
}: SmartStatusBarProps) {
  // MCP client data
  const {
    clients,
    aggregateMetrics,
    getHealthStatus,
    getSparklineData,
    disconnectClient,
  } = useEnhancedClients();

  // Claude status
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);

  // Modal states
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);


  // Error state from AI triage (via error-detected IPC)
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Environment info
  const [envInfo, setEnvInfo] = useState<EnvironmentInfo | null>(null);

  // Port detection
  const [detectedPort, setDetectedPort] = useState<number | null>(null);

  // Fetch Claude status on mount
  useEffect(() => {
    window.terminalAPI.getClaudeStatus().then(setClaudeStatus).catch(console.error);
  }, []);

  // Listen for AI-triaged error notifications (from terminal-bridge)
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as {
        type: string;
        sessionId?: string;
        exitCode?: number;
        command?: string;
        summary?: string;
      };

      if (msg.type === 'error-detected' && msg.sessionId === focusedSessionId) {
        setLastExitCode(msg.exitCode ?? null);
        setLastCommand(msg.command ?? null);
        setErrorSummary(msg.summary ?? null);
        setErrorDismissed(false);
      } else if (msg.type === 'error-dismissed' && msg.sessionId === focusedSessionId) {
        setLastExitCode(null);
        setLastCommand(null);
        setErrorSummary(null);
        setErrorDismissed(false);
      }
    });

    return cleanup;
  }, [focusedSessionId]);

  // Clear error state when focused session changes
  useEffect(() => {
    setLastExitCode(null);
    setLastCommand(null);
    setErrorSummary(null);
    setErrorDismissed(false);
  }, [focusedSessionId]);

  // Handle model change

  // Handle Continue in Claude click - type `claude --resume XXX --dangerously-skip-permissions`
  const handleContinueInClaude = useCallback(() => {
    if (!focusedSessionId || !claudeSessionId) return;
    const command = `claude --resume ${claudeSessionId} --dangerously-skip-permissions`;
    window.terminalAPI.input(focusedSessionId, command);
  }, [focusedSessionId, claudeSessionId]);

  // Handle error diagnosis - spawn claude with error context
  const handleDiagnose = useCallback(() => {
    if (!focusedSessionId || lastExitCode === null) return;

    const query = lastCommand
      ? `The command "${lastCommand}" failed with exit code ${lastExitCode}. What went wrong and how can I fix it?`
      : `My last command failed with exit code ${lastExitCode}. What does this mean and how can I fix it?`;

    window.terminalAPI.input(focusedSessionId, `? ${query}\n`);
    setErrorModalOpen(false);
    setErrorDismissed(true);
  }, [focusedSessionId, lastExitCode, lastCommand]);

  // Handle error dismiss
  const handleErrorDismiss = useCallback(() => {
    setErrorDismissed(true);
    setErrorModalOpen(false);
  }, []);

  // Handle port click - open in browser
  const handlePortClick = useCallback(() => {
    if (detectedPort) {
      window.terminalAPI.openExternal(`http://localhost:${detectedPort}`);
    }
  }, [detectedPort]);

  // Only show MCP badge when MCP is attached/enabled AND clients are connected
  const showMcpBadge = mcpAttachedSessionId !== null && clients.size > 0;

  // Compute plugin badge states for visibility check
  const plugins = getPlugins();
  const pluginBadgeStates = plugins.map((p) => ({
    plugin: p,
    state: p.getBadgeState(workspace),
  }));
  const hasPluginBadges = pluginBadgeStates.some((p) => p.state.visible);

  // Compute whether any badges are visible
  const hasBadges =
    showMcpBadge ||
    (focusedSessionId && claudeSessionId && claudeStatus?.authenticated) || // ContinueInClaudeBadge
    (lastExitCode !== null && lastExitCode !== 0 && !errorDismissed) || // ErrorBadge
    hasPluginBadges || // Plugin badges (git, etc.)
    detectedPort !== null || // PortBadge
    envInfo !== null; // EnvironmentBadge

  return (
    <div className={`smart-status-bar${!hasBadges ? ' smart-status-bar--compact' : ''}`}>
      <div className="smart-status-bar__left">
        {/* Plugin Badges - rendered dynamically from registry */}
        {pluginBadgeStates.map(({ plugin, state }) => {
          if (!state.visible) return null;
          const Badge = plugin.Badge;
          return (
            <Badge
              key={plugin.definition.id}
              state={state}
              isActive={activeSidebarPlugin === plugin.definition.id}
              onClick={() => onTogglePlugin(plugin.definition.id)}
            />
          );
        })}

        {/* MCP Badge - only when MCP is enabled (attached) AND clients connected */}
        {showMcpBadge && (
          <McpBadge
            isAttached={mcpAttachedSessionId !== null}
            clients={clients}
            metrics={aggregateMetrics}
            onClick={() => setMcpModalOpen(true)}
          />
        )}

        {/* Continue in Claude Badge - only when there's an active Claude session */}
        {focusedSessionId && claudeSessionId && claudeStatus?.authenticated && (
          <ContinueInClaudeBadge
            claudeSessionId={claudeSessionId}
            onClick={handleContinueInClaude}
          />
        )}

        {/* Error Badge */}
        <ErrorBadge
          exitCode={lastExitCode}
          dismissed={errorDismissed}
          summary={errorSummary}
          onClick={() => setErrorModalOpen(true)}
        />
      </div>

      <div className="smart-status-bar__right">
        {/* Port Badge */}
        <PortBadge port={detectedPort} onClick={handlePortClick} />

        {/* Environment Badge */}
        <EnvironmentBadge info={envInfo} onClick={() => {}} />

        {/* Feedback Badge - always visible */}
        <FeedbackBadge onClick={() => setFeedbackModalOpen(true)} />
      </div>

      {/* Modals */}
      {showMcpBadge && (
        <McpModal
          isOpen={mcpModalOpen}
          onClose={() => setMcpModalOpen(false)}
          clients={clients}
          metrics={aggregateMetrics}
          getHealthStatus={getHealthStatus}
          getSparklineData={getSparklineData}
          onDisconnectClient={disconnectClient}
          onShowInstructions={onShowMcpInstructions}
        />
      )}

      <ErrorModal
        isOpen={errorModalOpen}
        onClose={() => setErrorModalOpen(false)}
        exitCode={lastExitCode ?? 0}
        command={lastCommand ?? undefined}
        summary={errorSummary ?? undefined}
        onDiagnose={handleDiagnose}
        onDismiss={handleErrorDismiss}
      />

      <FeedbackModal
        isOpen={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
      />

    </div>
  );
}
