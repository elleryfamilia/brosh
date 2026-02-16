/**
 * Model Selector Dropdown Component
 *
 * Dropdown menu for selecting Claude model (haiku, sonnet, opus).
 * Appears when clicking the Claude status indicator in the status bar.
 */

import { useEffect, useRef, useCallback } from "react";

export type ClaudeModel = "haiku" | "sonnet" | "opus";

interface ModelSelectorProps {
  currentModel: ClaudeModel;
  onModelChange: (model: ClaudeModel) => void;
  onClose: () => void;
  position: { x: number; y: number };
}

const MODELS: { id: ClaudeModel; name: string; description: string }[] = [
  { id: "haiku", name: "Haiku", description: "Fast, lightweight responses" },
  { id: "sonnet", name: "Sonnet", description: "Balanced speed and capability" },
  { id: "opus", name: "Opus", description: "Most capable, detailed responses" },
];

export function ModelSelector({
  currentModel,
  onModelChange,
  onClose,
  position,
}: ModelSelectorProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Use setTimeout to avoid immediately closing from the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleModelSelect = useCallback(
    (model: ClaudeModel) => {
      onModelChange(model);
      onClose();
    },
    [onModelChange, onClose]
  );

  // Position the dropdown above the click point (since status bar is at bottom)
  // Ensure it stays within the window bounds
  const menuWidth = 200; // min-width from CSS
  const padding = 12; // Keep some padding from edges

  // Calculate left position, ensuring it doesn't overflow right edge
  let left = position.x;
  if (left + menuWidth > window.innerWidth - padding) {
    left = window.innerWidth - menuWidth - padding;
  }
  // Ensure it doesn't overflow left edge
  if (left < padding) {
    left = padding;
  }

  const style: React.CSSProperties = {
    position: "fixed",
    left,
    bottom: window.innerHeight - position.y + 8,
  };

  return (
    <div ref={menuRef} className="model-selector" style={style}>
      <div className="model-selector-header">Select Model</div>
      <div className="model-selector-options">
        {MODELS.map((model) => (
          <button
            key={model.id}
            className={`model-selector-option ${
              model.id === currentModel ? "model-selector-option-active" : ""
            }`}
            onClick={() => handleModelSelect(model.id)}
          >
            <span className="model-selector-radio">
              {model.id === currentModel ? "\u25CF" : "\u25CB"}
            </span>
            <div className="model-selector-info">
              <span className="model-selector-name">{model.name}</span>
              <span className="model-selector-description">
                {model.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
