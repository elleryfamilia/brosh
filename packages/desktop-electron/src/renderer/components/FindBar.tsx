/**
 * FindBar Component
 *
 * A search overlay for terminal content, similar to iTerm2's Cmd+F find feature.
 * Provides text search with options for case sensitivity, whole word, and regex.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { SearchOptions } from "./Terminal";

interface FindBarProps {
  isOpen: boolean;
  onClose: () => void;
  onFindNext: (term: string, options: SearchOptions) => boolean;
  onFindPrevious: (term: string, options: SearchOptions) => boolean;
  onClearSearch: () => void;
}

export function FindBar({
  isOpen,
  onClose,
  onFindNext,
  onFindPrevious,
  onClearSearch,
}: FindBarProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Clear search decorations when closing
  useEffect(() => {
    if (!isOpen) {
      onClearSearch();
    }
  }, [isOpen, onClearSearch]);

  const searchOptions: SearchOptions = {
    caseSensitive,
    wholeWord,
    regex,
  };

  const handleFindNext = useCallback(() => {
    if (searchTerm) {
      onFindNext(searchTerm, searchOptions);
    }
  }, [searchTerm, searchOptions, onFindNext]);

  const handleFindPrevious = useCallback(() => {
    if (searchTerm) {
      onFindPrevious(searchTerm, searchOptions);
    }
  }, [searchTerm, searchOptions, onFindPrevious]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          handleFindPrevious();
        } else {
          handleFindNext();
        }
      }
    },
    [onClose, handleFindNext, handleFindPrevious]
  );

  // Trigger search on term change (incremental search)
  useEffect(() => {
    if (searchTerm) {
      onFindNext(searchTerm, searchOptions);
    } else {
      onClearSearch();
    }
  }, [searchTerm, caseSensitive, wholeWord, regex]);

  if (!isOpen) return null;

  // Prevent clicks on find bar from bubbling up and closing it
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="find-bar" onKeyDown={handleKeyDown} onClick={handleClick}>
      <input
        ref={inputRef}
        type="text"
        className="find-bar-input"
        placeholder="Find..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />

      {/* Option toggles */}
      <button
        className={`find-bar-option${caseSensitive ? " active" : ""}`}
        onClick={() => setCaseSensitive(!caseSensitive)}
        title="Match Case (Aa)"
      >
        Aa
      </button>
      <button
        className={`find-bar-option${wholeWord ? " active" : ""}`}
        onClick={() => setWholeWord(!wholeWord)}
        title="Match Whole Word"
      >
        <span style={{ fontWeight: "bold" }}>[</span>ab<span style={{ fontWeight: "bold" }}>]</span>
      </button>
      <button
        className={`find-bar-option${regex ? " active" : ""}`}
        onClick={() => setRegex(!regex)}
        title="Use Regular Expression"
      >
        .*
      </button>

      {/* Navigation */}
      <button
        className="find-bar-nav"
        onClick={handleFindPrevious}
        title="Previous Match (Shift+Enter)"
      >
        &#x25B2;
      </button>
      <button
        className="find-bar-nav"
        onClick={handleFindNext}
        title="Next Match (Enter)"
      >
        &#x25BC;
      </button>

      {/* Close */}
      <button className="find-bar-close" onClick={onClose} title="Close (Escape)">
        &#x2715;
      </button>
    </div>
  );
}
