/**
 * Claude Permissions Prompt Component
 *
 * Inline prompt shown inside ClaudePanel on first launch.
 * Asks whether to use --dangerously-skip-permissions.
 */

import { useState, useCallback } from "react";
import { ClaudeIcon } from "./icons/ClaudeIcon";

interface ClaudePermissionsPromptProps {
  onChoice: (skipPermissions: boolean) => void;
  onRememberChoice: (remember: boolean) => void;
}

export function ClaudePermissionsPrompt({
  onChoice,
  onRememberChoice,
}: ClaudePermissionsPromptProps) {
  const [remember, setRemember] = useState(false);

  const handleRememberChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setRemember(e.target.checked);
      onRememberChoice(e.target.checked);
    },
    [onRememberChoice]
  );

  return (
    <div className="claude-permissions-prompt">
      <ClaudeIcon size={32} className="claude-permissions-icon" />
      <h3 className="claude-permissions-heading">Launch Claude Code</h3>
      <p className="claude-permissions-desc">
        Auto-approve tool use? This runs Claude Code in{" "}
        <code>dontAsk</code> mode with common tools pre-approved
        (Bash, Read, Edit, Write, WebFetch, WebSearch).
        Unlisted tools are silently denied.
      </p>
      <div className="claude-permissions-actions">
        <button
          className="claude-permissions-btn claude-permissions-btn-primary"
          onClick={() => onChoice(true)}
        >
          Yes, auto-approve
        </button>
        <button
          className="claude-permissions-btn"
          onClick={() => onChoice(false)}
        >
          No, ask each time
        </button>
      </div>
      <label className="claude-permissions-remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={handleRememberChange}
        />
        <span>Remember my choice</span>
      </label>
    </div>
  );
}
