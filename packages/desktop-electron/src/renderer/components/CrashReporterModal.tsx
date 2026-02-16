/**
 * CrashReporterModal Component
 *
 * Shows when an error occurs, allowing users to review
 * the error details before optionally sending a report.
 */

import { useState, useCallback } from 'react';

interface CrashReporterModalProps {
  isOpen: boolean;
  error: Error | null;
  errorInfo?: string;
  onClose: () => void;
  onReload: () => void;
}

/**
 * Sanitize error details to remove potential PII
 */
function sanitizeForDisplay(text: string): string {
  return text
    // Remove home directory paths
    .replace(/\/Users\/[^/\s]+\//g, '~/')
    .replace(/\\Users\\[^\\\s]+\\/g, '~\\')
    // Remove potential emails
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    // Truncate very long lines
    .split('\n')
    .map(line => line.length > 200 ? line.slice(0, 200) + '...' : line)
    .slice(0, 15) // Max 15 lines
    .join('\n');
}

export function CrashReporterModal({
  isOpen,
  error,
  errorInfo,
  onClose,
  onReload,
}: CrashReporterModalProps) {
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [additionalInfo, setAdditionalInfo] = useState('');

  // Build the error report that will be shown/sent
  const errorReport = error ? {
    type: error.name || 'Error',
    message: sanitizeForDisplay(error.message || 'Unknown error'),
    stack: error.stack ? sanitizeForDisplay(error.stack) : undefined,
    componentStack: errorInfo ? sanitizeForDisplay(errorInfo) : undefined,
  } : null;

  const handleSend = useCallback(async () => {
    if (!errorReport) return;

    setIsSending(true);
    try {
      const reportMessage = [
        `**Error Type:** ${errorReport.type}`,
        `**Message:** ${errorReport.message}`,
        errorReport.stack ? `**Stack:**\n\`\`\`\n${errorReport.stack}\n\`\`\`` : '',
        errorReport.componentStack ? `**Component Stack:**\n\`\`\`\n${errorReport.componentStack}\n\`\`\`` : '',
        additionalInfo ? `**Additional Info:** ${additionalInfo}` : '',
      ].filter(Boolean).join('\n\n');

      await window.terminalAPI.analyticsSubmitFeedback(
        'bug',
        reportMessage,
        undefined
      );
      setSent(true);
    } catch (err) {
      console.error('Failed to send crash report:', err);
    } finally {
      setIsSending(false);
    }
  }, [errorReport, additionalInfo]);

  if (!isOpen || !error) return null;

  return (
    <div className="crash-reporter-overlay">
      <div className="crash-reporter-modal">
        <div className="crash-reporter-header">
          <div className="crash-reporter-icon">!</div>
          <div className="crash-reporter-title">
            <h2>Something went wrong</h2>
            <p>The application encountered an unexpected error</p>
          </div>
        </div>

        <div className="crash-reporter-content">
          {sent ? (
            <div className="crash-reporter-sent">
              <span className="crash-reporter-sent-icon">✓</span>
              <p>Report sent. Thank you for helping improve brosh!</p>
            </div>
          ) : (
            <>
              <p className="crash-reporter-explanation">
                You can help us fix this by sending an error report.
                Review the information below before sending:
              </p>

              <div className="crash-reporter-details">
                <div className="crash-reporter-field">
                  <label>Error Type</label>
                  <code>{errorReport?.type}</code>
                </div>
                <div className="crash-reporter-field">
                  <label>Message</label>
                  <code>{errorReport?.message}</code>
                </div>
                {errorReport?.stack && (
                  <div className="crash-reporter-field">
                    <label>Stack Trace</label>
                    <pre>{errorReport.stack}</pre>
                  </div>
                )}
              </div>

              <div className="crash-reporter-additional">
                <label>What were you doing when this happened? (optional)</label>
                <textarea
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="e.g., I was opening settings when..."
                  rows={2}
                />
              </div>
            </>
          )}
        </div>

        <div className="crash-reporter-footer">
          {sent ? (
            <button className="crash-reporter-btn primary" onClick={onReload}>
              Reload Application
            </button>
          ) : (
            <>
              <button
                className="crash-reporter-btn secondary"
                onClick={onClose}
              >
                Dismiss
              </button>
              <button
                className="crash-reporter-btn secondary"
                onClick={onReload}
              >
                Reload
              </button>
              <button
                className="crash-reporter-btn primary"
                onClick={handleSend}
                disabled={isSending}
              >
                {isSending ? 'Sending...' : 'Send Report'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
