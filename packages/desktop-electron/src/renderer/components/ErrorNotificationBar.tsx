/**
 * Error Notification Bar
 *
 * Inline notification shown at the bottom of a terminal pane
 * when a command exits with a non-zero exit code (via OSC 133;D).
 */

import { useCallback } from "react";

export interface ErrorNotification {
  sessionId: string;
  exitCode?: number;
  command?: string;
  summary?: string;
  timestamp: number;
}

interface ErrorNotificationBarProps {
  notification: ErrorNotification;
  onDismiss: (sessionId: string) => void;
}

export function ErrorNotificationBar({
  notification,
  onDismiss,
}: ErrorNotificationBarProps) {
  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.sessionId);
    },
    [notification.sessionId, onDismiss]
  );

  const message = notification.summary
    ? notification.summary
    : notification.exitCode !== undefined
      ? `Command exited with code ${notification.exitCode}`
      : "Command failed";

  return (
    <div className="error-notification-bar">
      <div className="error-notification-content">
        <span className="error-notification-icon">!</span>
        <span className="error-notification-message">{message}</span>
      </div>
      <button
        className="error-notification-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss error notification"
      >
        &times;
      </button>
    </div>
  );
}
