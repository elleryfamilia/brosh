/**
 * MCP Modal Component
 *
 * Shows detailed MCP client information.
 */

import { StatusBarModal } from '../StatusBarModal';
import type { EnhancedClient, AggregateMetrics, HealthStatus } from '../../mcp-dashboard/types';
import { HealthIndicator } from '../../mcp-dashboard/HealthIndicator';
import { MiniSparkline } from '../../mcp-dashboard/MiniSparkline';

interface McpModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Map<string, EnhancedClient>;
  metrics: AggregateMetrics;
  getHealthStatus: (client: EnhancedClient) => HealthStatus;
  getSparklineData: (client: EnhancedClient) => number[];
  onDisconnectClient: (clientId: string) => void;
  onShowInstructions: () => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function McpModal({
  isOpen,
  onClose,
  clients,
  metrics,
  getHealthStatus,
  getSparklineData,
  onDisconnectClient,
  onShowInstructions,
}: McpModalProps) {
  const clientArray = Array.from(clients.values());

  return (
    <StatusBarModal isOpen={isOpen} onClose={onClose} title="MCP Connections" width={380}>
      <div className="mcp-modal">
        {/* Summary stats */}
        {metrics.totalCalls > 0 && (
          <div className="mcp-modal__summary">
            <div className="mcp-modal__stat">
              <span className="mcp-modal__stat-value">{metrics.totalCalls}</span>
              <span className="mcp-modal__stat-label">calls</span>
            </div>
            <div className="mcp-modal__stat">
              <span className="mcp-modal__stat-value">{metrics.successRate}%</span>
              <span className="mcp-modal__stat-label">success</span>
            </div>
            {metrics.avgLatencyMs > 0 && (
              <div className="mcp-modal__stat">
                <span className="mcp-modal__stat-value">{metrics.avgLatencyMs}ms</span>
                <span className="mcp-modal__stat-label">avg latency</span>
              </div>
            )}
          </div>
        )}

        {/* Client list */}
        <div className="mcp-modal__clients">
          {clientArray.length === 0 ? (
            <div className="mcp-modal__empty">
              <p>No clients connected</p>
              <button
                className="mcp-modal__btn mcp-modal__btn--secondary"
                onClick={onShowInstructions}
              >
                View Connection Instructions
              </button>
            </div>
          ) : (
            clientArray.map((client) => {
              const health = getHealthStatus(client);
              const sparkline = getSparklineData(client);
              const connectedDuration = Date.now() - client.connectedAt;

              return (
                <div key={client.clientId} className="mcp-modal__client">
                  <div className="mcp-modal__client-header">
                    <HealthIndicator status={health} />
                    <span className="mcp-modal__client-name">{client.friendlyName}</span>
                    <span className="mcp-modal__client-duration">
                      {formatDuration(connectedDuration)}
                    </span>
                  </div>

                  {client.clientInfo && (
                    <div className="mcp-modal__client-info">
                      {client.clientInfo.name} v{client.clientInfo.version}
                    </div>
                  )}

                  <div className="mcp-modal__client-stats">
                    <span>{client.stats.totalCalls} calls</span>
                    {client.stats.avgLatencyMs > 0 && (
                      <span>{client.stats.avgLatencyMs}ms avg</span>
                    )}
                    <MiniSparkline data={sparkline} height={16} width={80} />
                  </div>

                  {client.stats.lastMethod && (
                    <div className="mcp-modal__client-last">
                      Last: <code>{client.stats.lastMethod}</code>
                    </div>
                  )}

                  <button
                    className="mcp-modal__btn mcp-modal__btn--danger"
                    onClick={() => onDisconnectClient(client.clientId)}
                  >
                    Disconnect
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </StatusBarModal>
  );
}
