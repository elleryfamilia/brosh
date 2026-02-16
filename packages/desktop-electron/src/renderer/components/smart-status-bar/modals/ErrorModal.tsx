/**
 * Error Modal Component
 *
 * Shows error details and offers diagnosis options.
 */

import { StatusBarModal } from '../StatusBarModal';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  exitCode: number;
  command?: string;
  summary?: string;
  stderr?: string;
  onDiagnose: () => void;
  onDismiss: () => void;
}

function getExitCodeExplanation(code: number): { name: string; description: string } {
  switch (code) {
    case 1:
      return {
        name: 'General Error',
        description: 'The command encountered an unspecified error.',
      };
    case 2:
      return {
        name: 'Misuse of Shell Command',
        description: 'Invalid arguments or incorrect usage of a shell builtin.',
      };
    case 126:
      return {
        name: 'Permission Denied',
        description: 'The command could not be executed due to permission restrictions.',
      };
    case 127:
      return {
        name: 'Command Not Found',
        description: 'The command does not exist or is not in your PATH.',
      };
    case 128:
      return {
        name: 'Invalid Exit Argument',
        description: 'The exit status was out of range (0-255).',
      };
    case 130:
      return {
        name: 'Interrupted (SIGINT)',
        description: 'The command was interrupted by Ctrl+C.',
      };
    case 137:
      return {
        name: 'Killed (SIGKILL)',
        description: 'The process was forcibly terminated, possibly due to memory limits.',
      };
    case 139:
      return {
        name: 'Segmentation Fault',
        description: 'The program attempted to access invalid memory.',
      };
    case 143:
      return {
        name: 'Terminated (SIGTERM)',
        description: 'The process was gracefully terminated.',
      };
    default:
      if (code > 128 && code < 165) {
        const signal = code - 128;
        return {
          name: `Signal ${signal}`,
          description: `The process was terminated by signal ${signal}.`,
        };
      }
      return {
        name: `Exit Code ${code}`,
        description: 'The command returned a non-zero exit status.',
      };
  }
}

export function ErrorModal({
  isOpen,
  onClose,
  exitCode,
  command,
  summary,
  stderr,
  onDiagnose,
  onDismiss,
}: ErrorModalProps) {
  const explanation = getExitCodeExplanation(exitCode);

  return (
    <StatusBarModal isOpen={isOpen} onClose={onClose} title="Command Error" width={420}>
      <div className="error-modal">
        {/* Exit code */}
        <div className="error-modal__code">
          <span className="error-modal__code-label">Exit Code</span>
          <span className="error-modal__code-value">{exitCode}</span>
        </div>

        {/* Explanation */}
        <div className="error-modal__explanation">
          <div className="error-modal__explanation-name">{explanation.name}</div>
          <div className="error-modal__explanation-desc">{explanation.description}</div>
        </div>

        {/* AI Summary */}
        {summary && (
          <div className="error-modal__summary">
            <div className="error-modal__summary-label">AI Analysis</div>
            <div className="error-modal__summary-value">{summary}</div>
          </div>
        )}

        {/* Command that failed */}
        {command && (
          <div className="error-modal__command">
            <div className="error-modal__command-label">Command</div>
            <code className="error-modal__command-value">{command}</code>
          </div>
        )}

        {/* Stderr output */}
        {stderr && (
          <div className="error-modal__stderr">
            <div className="error-modal__stderr-label">Error Output</div>
            <pre className="error-modal__stderr-value">{stderr}</pre>
          </div>
        )}

        {/* Actions */}
        <div className="error-modal__actions">
          <button
            className="error-modal__btn error-modal__btn--primary"
            onClick={onDiagnose}
          >
            Diagnose with AI
          </button>
          <button
            className="error-modal__btn error-modal__btn--secondary"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </StatusBarModal>
  );
}
