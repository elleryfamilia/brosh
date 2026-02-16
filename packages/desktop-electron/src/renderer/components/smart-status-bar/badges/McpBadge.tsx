/**
 * MCP Badge Component
 *
 * Shows MCP client count when clients are connected.
 * Only rendered when there are connected clients.
 */

import { McpIcon } from '../../icons/McpIcon';
import { StatusBarBadge } from '../StatusBarBadge';
import type { EnhancedClient, AggregateMetrics } from '../../mcp-dashboard/types';

interface McpBadgeProps {
  isAttached: boolean;
  clients: Map<string, EnhancedClient>;
  metrics: AggregateMetrics;
  onClick: () => void;
}

export function McpBadge({ clients, metrics, onClick }: McpBadgeProps) {
  const clientCount = clients.size;

  // Should not render if no clients (parent component handles this)
  if (clientCount === 0) {
    return null;
  }

  const label = clientCount === 1 ? '1 client' : `${clientCount} clients`;

  return (
    <StatusBarBadge
      label={label}
      icon={<McpIcon size={16} isActive />}
      active
      onClick={onClick}
      title={
        metrics.totalCalls > 0
          ? `${metrics.totalCalls} calls, ${metrics.successRate}% success`
          : `${clientCount} MCP client${clientCount !== 1 ? 's' : ''} connected`
      }
    />
  );
}
