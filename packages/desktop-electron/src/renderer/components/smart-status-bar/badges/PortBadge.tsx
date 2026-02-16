/**
 * Port Badge Component
 *
 * Shows when a server port is detected (e.g., "listening on port 3000").
 */

import { StatusBarBadge } from '../StatusBarBadge';

interface PortBadgeProps {
  port: number | null;
  onClick: () => void;
}

export function PortBadge({ port, onClick }: PortBadgeProps) {
  if (!port) {
    return null;
  }

  return (
    <StatusBarBadge
      label={`localhost:${port}`}
      variant="info"
      onClick={onClick}
      title={`Server detected on port ${port} - click to open in browser`}
      className="port-status-badge"
    />
  );
}
