/**
 * FeedbackBadge Component
 *
 * Subtle icon-only badge in the status bar for sending feedback.
 * Opens the FeedbackModal when clicked.
 */

interface FeedbackBadgeProps {
  onClick: () => void;
}

export function FeedbackBadge({ onClick }: FeedbackBadgeProps) {
  return (
    <button
      className="feedback-badge"
      onClick={onClick}
      title="Send feedback"
      aria-label="Send feedback"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
