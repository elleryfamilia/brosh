/**
 * Error Badge Component
 *
 * Shows when the last command exited with a non-zero code.
 * Uses OSC 133 shell integration for exit code detection.
 */

import { ErrorIcon } from '../../icons/ErrorIcon';
import { StatusBarBadge } from '../StatusBarBadge';

interface ErrorBadgeProps {
  exitCode: number | null;
  dismissed: boolean;
  summary?: string | null;
  onClick: () => void;
}

export function ErrorBadge({ exitCode, dismissed, summary, onClick }: ErrorBadgeProps) {
  // Don't show if no error or dismissed
  if (exitCode === null || exitCode === 0 || dismissed) {
    return null;
  }

  // Map common exit codes to human-readable descriptions
  const getExitCodeDescription = (code: number): string => {
    switch (code) {
      case 1:
        return 'General error';
      case 2:
        return 'Misuse of shell command';
      case 126:
        return 'Permission denied';
      case 127:
        return 'Command not found';
      case 128:
        return 'Invalid exit argument';
      case 130:
        return 'Script terminated (Ctrl+C)';
      case 137:
        return 'Process killed (SIGKILL)';
      case 139:
        return 'Segmentation fault';
      case 143:
        return 'Process terminated (SIGTERM)';
      default:
        if (code > 128 && code < 165) {
          return `Signal ${code - 128}`;
        }
        return `Exit code ${code}`;
    }
  };

  const label = summary || `Error ${exitCode}`;

  return (
    <StatusBarBadge
      label={label}
      icon={<ErrorIcon size={16} />}
      pulsing
      onClick={onClick}
      title={summary || getExitCodeDescription(exitCode)}
    />
  );
}
