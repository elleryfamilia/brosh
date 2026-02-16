/**
 * Claude Model Badge Component
 *
 * Shows the current Claude model and allows changing it.
 * Always visible when Claude is installed and authenticated.
 */

import { ClaudeIcon } from '../../icons/ClaudeIcon';
import type { ClaudeStatus } from '../../../types/electron.d';

interface ClaudeModelBadgeProps {
  claudeStatus: ClaudeStatus | null;
  onModelClick: (e: React.MouseEvent) => void;
}

export function ClaudeModelBadge({ claudeStatus, onModelClick }: ClaudeModelBadgeProps) {
  // Don't show if Claude is not installed
  if (!claudeStatus?.installed) {
    return null;
  }

  const isAuthenticated = claudeStatus.authenticated;
  const model = claudeStatus.model || 'haiku';

  if (!isAuthenticated) {
    // Show warning state when not authenticated
    return (
      <span
        className="status-bar-badge status-bar-badge--warning claude-badge-warning"
        title="Claude not authenticated - run `claude login`"
      >
        <ClaudeIcon size={16} />
        <span>Claude</span>
        <span className="claude-badge__warning-icon">{'\u26A0'}</span>
      </span>
    );
  }

  return (
    <button
      className="status-bar-badge status-bar-badge--clickable claude-badge-model"
      onClick={onModelClick}
      title={`Current model: ${model} - click to change`}
      type="button"
    >
      <ClaudeIcon size={16} />
      <span>{model}</span>
    </button>
  );
}
