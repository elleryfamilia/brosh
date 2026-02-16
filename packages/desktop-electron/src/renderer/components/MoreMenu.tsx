/**
 * More Menu Component
 *
 * Three-dots button that opens a dropdown menu.
 * Used in TitleBar and PaneHeader to consolidate MCP and settings actions.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { MoreMenuIcon } from "./icons";

export interface MoreMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  indicator?: "mcp";
  indicatorActive?: boolean;
  shortcut?: string;
  onClick: () => void;
}

interface MoreMenuProps {
  items: MoreMenuItem[];
  size: "titlebar" | "pane";
}

export function MoreMenu({ items, size }: MoreMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((v) => !v);
  }, []);

  // Close on click-outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Position dropdown below button, right-aligned to button's right edge
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const top = rect.bottom + 4;
    const right = window.innerWidth - rect.right;
    setPos({ top, right });
  }, [isOpen]);

  const handleItemClick = useCallback((item: MoreMenuItem) => {
    item.onClick();
    setIsOpen(false);
  }, []);

  if (items.length === 0) return null;

  const btnSize = size === "titlebar" ? 28 : 22;
  const iconSize = size === "titlebar" ? 20 : 14;

  return (
    <>
      <button
        ref={buttonRef}
        className={`more-menu-button more-menu-${size}`}
        onClick={toggle}
        title="Menu"
        type="button"
        style={{ width: btnSize, height: btnSize, WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <MoreMenuIcon size={iconSize} />
      </button>
      {isOpen && pos && (
        <div
          ref={menuRef}
          className="more-menu-dropdown"
          style={{ top: pos.top, right: pos.right }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              className="more-menu-item"
              onClick={() => handleItemClick(item)}
            >
              {item.icon && <span className="more-menu-item-icon">{item.icon}</span>}
              <span className="more-menu-item-label">{item.label}</span>
              {item.indicator && (
                <span
                  className={`more-menu-item-indicator more-menu-item-indicator-${item.indicator} ${item.indicatorActive ? "active" : ""}`}
                />
              )}
              {item.shortcut && (
                <span className="more-menu-item-shortcut">{item.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
