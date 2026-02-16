/**
 * MCP Dashboard Header Component
 *
 * Smart summary bar with aggregate metrics that can collapse/expand.
 * Also serves as the status bar showing MCP, Claude, and recording status.
 */

import type { AggregateMetrics } from './types';
import type { ClaudeStatus } from '../../types/electron';
import { ClaudeIcon } from '../icons/ClaudeIcon';

interface McpDashboardHeaderProps {
  isExpanded: boolean;
  metrics: AggregateMetrics;
  onToggle: () => void;
  onClear: () => void;
  mcpAttached: boolean;
  isRecording: boolean;
  claudeStatus: ClaudeStatus | null;
  onClaudeClick: (e: React.MouseEvent) => void;
}

export function McpDashboardHeader({
  isExpanded,
  metrics,
  onToggle,
  onClear,
  mcpAttached,
  isRecording,
  claudeStatus,
  onClaudeClick,
}: McpDashboardHeaderProps) {
  const getSuccessRateClass = () => {
    if (metrics.successRate >= 95) return 'rate-good';
    if (metrics.successRate >= 80) return 'rate-warning';
    return 'rate-error';
  };

  return (
    <div className="mcp-dashboard-header" onClick={onToggle}>
      <div className="mcp-dashboard-header-left">
        {/* MCP Badge with status */}
        <span className={`mcp-dashboard-badge ${mcpAttached ? 'mcp-attached' : ''}`}>
          MCP
        </span>

        {/* Claude Badge with status */}
        {claudeStatus?.installed && (
          <button
            className={`mcp-dashboard-badge claude-badge ${claudeStatus.authenticated ? 'claude-authenticated' : 'claude-warning'}`}
            onClick={onClaudeClick}
            title={
              claudeStatus.authenticated
                ? `Claude (${claudeStatus.model || 'haiku'}) - Click to change model`
                : 'Claude not authenticated - Run `claude login`'
            }
          >
            <ClaudeIcon size={12} />
            <span>Claude{claudeStatus.authenticated ? ` (${claudeStatus.model || 'haiku'})` : ''}</span>
            {!claudeStatus.authenticated && <span className="claude-warning-icon">{'\u26A0'}</span>}
          </button>
        )}

        {/* Client count */}
        {metrics.totalClients > 0 && (
          <span className="mcp-dashboard-clients">
            {metrics.totalClients} client{metrics.totalClients !== 1 ? 's' : ''}
          </span>
        )}

        {/* Metrics when there's activity */}
        {metrics.totalCalls > 0 && (
          <>
            <span className="mcp-dashboard-divider">|</span>
            <span className="mcp-dashboard-calls">{metrics.totalCalls} calls</span>
            <span className="mcp-dashboard-divider">|</span>
            <span className={`mcp-dashboard-rate ${getSuccessRateClass()}`}>
              {metrics.successRate}%
            </span>
            {metrics.avgLatencyMs > 0 && (
              <>
                <span className="mcp-dashboard-divider">|</span>
                <span className="mcp-dashboard-latency">
                  {metrics.avgLatencyMs}ms
                </span>
              </>
            )}
          </>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <>
            <span className="mcp-dashboard-divider">|</span>
            <span className="mcp-dashboard-recording">
              <span className="recording-dot" />
              REC
            </span>
          </>
        )}
      </div>

      <div className="mcp-dashboard-header-right">
        {/* Clear button when expanded */}
        {isExpanded && metrics.totalCalls > 0 && (
          <button
            className="mcp-dashboard-clear"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            Clear
          </button>
        )}

        {/* Expand/collapse toggle */}
        <span className="mcp-dashboard-toggle">
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>
    </div>
  );
}
