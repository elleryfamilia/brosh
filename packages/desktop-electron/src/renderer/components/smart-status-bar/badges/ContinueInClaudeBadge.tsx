/**
 * Continue in Claude Badge Component
 *
 * Shows only when there's an active Claude session for the focused terminal.
 * Clicking it types `claude --resume XXX --dangerously-skip-permissions` in the terminal.
 */

interface ContinueInClaudeBadgeProps {
  claudeSessionId: string;
  onClick: () => void;
}

function ContinueIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2.5v11l9.5-5.5L3 2.5z" fill="currentColor" />
    </svg>
  );
}

export function ContinueInClaudeBadge({ claudeSessionId, onClick }: ContinueInClaudeBadgeProps) {
  const shortId = claudeSessionId.substring(0, 8);

  return (
    <button
      className="status-bar-badge status-bar-badge--clickable claude-badge-continue"
      onClick={onClick}
      title={`Resume Claude session ${claudeSessionId}`}
      type="button"
    >
      <ContinueIcon size={14} />
      <span className="claude-badge-continue-text">
        <span>Continue in Claude</span>
        <span className="claude-badge-continue-session">{shortId}</span>
      </span>
    </button>
  );
}
