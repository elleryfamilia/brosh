/**
 * Environment Badge Component
 *
 * Shows active virtual environment (venv, conda, nvm, etc.)
 */

import { StatusBarBadge } from '../StatusBarBadge';
import type { EnvironmentInfo } from '../types';

interface EnvironmentBadgeProps {
  info: EnvironmentInfo | null;
  onClick: () => void;
}

function getEnvIcon(type: string): string {
  switch (type) {
    case 'venv':
    case 'conda':
      return '\uD83D\uDC0D'; // snake emoji for Python
    case 'nvm':
      return '\u2B22'; // hexagon for Node
    case 'nix':
      return '\u2744\uFE0F'; // snowflake for Nix
    default:
      return '';
  }
}

function formatLabel(info: EnvironmentInfo): string {
  if (!info.type) return '';

  const parts: string[] = [];

  // Add version if available
  if (info.version) {
    if (info.type === 'venv' || info.type === 'conda') {
      parts.push(`py ${info.version}`);
    } else if (info.type === 'nvm') {
      parts.push(`node ${info.version}`);
    } else {
      parts.push(info.version);
    }
  } else {
    parts.push(info.type);
  }

  // Add env name if different from type
  if (info.name && info.name !== info.type && info.name !== 'base') {
    parts.push(`(${info.name})`);
  }

  return parts.join(' ');
}

export function EnvironmentBadge({ info, onClick }: EnvironmentBadgeProps) {
  if (!info || !info.type) {
    return null;
  }

  const label = formatLabel(info);
  const icon = getEnvIcon(info.type);
  const title = info.path
    ? `${info.type} environment: ${info.path}`
    : `${info.type} environment active`;

  return (
    <StatusBarBadge
      label={icon ? `${icon} ${label}` : label}
      variant="info"
      onClick={onClick}
      title={title}
      className="env-status-badge"
    />
  );
}
