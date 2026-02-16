/**
 * MCP Conflict Dialog Component
 *
 * Modal dialog shown when user tries to enable MCP on a terminal
 * while another terminal already has MCP attached.
 */

interface McpConflictDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function McpConflictDialog({
  isOpen,
  onCancel,
  onConfirm,
}: McpConflictDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>MCP Already Enabled</h2>
        </div>
        <div className="dialog-body">
          <p>MCP already enabled in another terminal. Transfer it here?</p>
        </div>
        <div className="dialog-footer">
          <button className="dialog-button dialog-button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-button dialog-button-primary" onClick={onConfirm}>
            Disconnect & Enable Here
          </button>
        </div>
      </div>
    </div>
  );
}
