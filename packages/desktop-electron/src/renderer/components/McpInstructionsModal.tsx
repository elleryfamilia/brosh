/**
 * MCP Instructions Modal Component
 *
 * Modal dialog showing mcp.json connection instructions for AI agents.
 */

import { useState, useCallback } from "react";

interface McpInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// MCP configuration uses the brosh package
const mcpConfig = {
  mcpServers: {
    "brosh": {
      command: "npx",
      args: ["-y", "brosh"],
    },
  },
};

const mcpJson = JSON.stringify(mcpConfig, null, 2);

export function McpInstructionsModal({
  isOpen,
  onClose,
}: McpInstructionsModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mcpJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  }, []);

  const handleOverlayClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <div className="dialog mcp-instructions-dialog" onClick={handleDialogClick}>
        <div className="dialog-header">
          <h2>Connect an AI Agent</h2>
        </div>
        <div className="dialog-body">
          <p>
            Add this configuration to your AI tool's <code>mcp.json</code> file to connect it to this terminal:
          </p>
          <div className="mcp-instructions-code-container">
            <pre className="mcp-instructions-code">{mcpJson}</pre>
            <button
              className="mcp-instructions-copy-btn"
              onClick={handleCopy}
              title="Copy to clipboard"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="dialog-button dialog-button-primary" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
