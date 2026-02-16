/**
 * Terminal Component
 *
 * Renders an xterm.js terminal and connects it to the brosh backend
 * via Electron IPC.
 */

import { useEffect, useRef, useCallback, useMemo, useState, useImperativeHandle, forwardRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ImageAddon } from "@xterm/addon-image";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "../settings";
import type { Theme } from "../settings";

// Reuse TextDecoder instance to avoid allocating a new one per output chunk
const textDecoder = new TextDecoder();

/**
 * Escape a file path for safe shell usage.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function escapePathForShell(path: string): string {
  // If the path contains any special characters that need escaping
  if (/[^a-zA-Z0-9_./-]/.test(path)) {
    // Wrap in single quotes, escape embedded single quotes with '\''
    return `'${path.replace(/'/g, "'\\''")}'`;
  }
  return path;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface TerminalMethods {
  copy: () => void;
  paste: () => Promise<void>;
  selectAll: () => void;
  clear: () => void;
  hasSelection: () => boolean;
  getSelection: () => string;
  findNext: (term: string, options?: SearchOptions) => boolean;
  findPrevious: (term: string, options?: SearchOptions) => boolean;
  clearSearch: () => void;
}

export type InputMode = "COMMAND" | "AI" | null;

export interface TypoSuggestion {
  original: string;
  suggested: string;
  fullSuggestion: string;
  type: 'command' | 'subcommand';
}

export interface AutocompleteSuggestion {
  suggestion: string;
  ghostText: string;
}

interface TerminalProps {
  sessionId: string;
  onClose?: () => void;
  isVisible?: boolean;
  isFocused?: boolean;
  onFocus?: () => void;
  onContextMenu?: (e: React.MouseEvent, methods: TerminalMethods) => void;
  onInputModeChange?: (mode: InputMode) => void;
  onTypoSuggestionChange?: (suggestion: TypoSuggestion | null) => void;
  onAutocompleteChange?: (suggestion: AutocompleteSuggestion | null) => void;
  onMethodsReady?: (methods: TerminalMethods) => void;
  onFileLink?: (filePath: string, isDiff: boolean) => void;
  onAddToChat?: (sessionId: string, text: string) => void;
}

/**
 * Build xterm theme from app theme
 */
function buildXtermTheme(theme: Theme) {
  const { colors } = theme;
  return {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.foreground,
    cursorAccent: colors.background,
    selectionBackground: colors.accent + "80", // 50% opacity
    selectionForeground: colors.foreground,
    black: colors.ansi.black,
    red: colors.ansi.red,
    green: colors.ansi.green,
    yellow: colors.ansi.yellow,
    blue: colors.ansi.blue,
    magenta: colors.ansi.magenta,
    cyan: colors.ansi.cyan,
    white: colors.ansi.white,
    brightBlack: colors.ansi.brightBlack,
    brightRed: colors.ansi.brightRed,
    brightGreen: colors.ansi.brightGreen,
    brightYellow: colors.ansi.brightYellow,
    brightBlue: colors.ansi.brightBlue,
    brightMagenta: colors.ansi.brightMagenta,
    brightCyan: colors.ansi.brightCyan,
    brightWhite: colors.ansi.brightWhite,
  };
}

export function Terminal({ sessionId, onClose, isVisible = true, isFocused = true, onFocus, onContextMenu, onInputModeChange, onTypoSuggestionChange, onAutocompleteChange, onMethodsReady, onFileLink, onAddToChat }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const canvasAddonRef = useRef<CanvasAddon | null>(null);
  const webLinksAddonRef = useRef<WebLinksAddon | null>(null);
  const imageAddonRef = useRef<ImageAddon | null>(null);
  const clipboardAddonRef = useRef<ClipboardAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection state for keyboard selection (Shift+Arrow)
  const selectionStateRef = useRef<{
    anchor: { x: number; y: number };
    active: { x: number; y: number };
  } | null>(null);

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);

  // Scroll state for auto-hiding scrollbar
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autocomplete suggestion state (full suggestion + position for tooltip)
  const [autocompleteSuggestion, setAutocompleteSuggestion] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

  // "Add to Chat" floating button state
  const [addToChatBtn, setAddToChatBtn] = useState<{ top: number; left: number } | null>(null);

  // Ref for onAddToChat callback (to avoid re-creating terminal when callback changes)
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;

  // Shell integration: track command marks (OSC 133)
  interface CommandMark {
    type: 'prompt-start' | 'command-start' | 'output-start' | 'command-end';
    row: number;
    exitCode?: number;
  }
  const commandMarksRef = useRef<CommandMark[]>([]);
  const currentRowRef = useRef<number>(0);

  // Buffer switching state for TUI apps (Claude CLI, vim, etc.)
  const isInAlternateBufferRef = useRef<boolean>(false);
  const savedNormalBufferScrollRef = useRef<{
    scrollPos: number;
    baseY: number;
    wasAtBottom: boolean;
  } | null>(null);

  // Ref for file link callback (to avoid re-creating terminal when callback changes)
  const onFileLinkRef = useRef(onFileLink);
  onFileLinkRef.current = onFileLink;

  // Get settings and theme
  const { settings, theme } = useSettings();

  // Build xterm theme from current theme
  const xtermTheme = useMemo(() => buildXtermTheme(theme), [theme]);

  // Handle terminal output from backend
  const handleOutput = useCallback((data: string) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
    }
  }, []);

  // Handle session close
  const handleSessionClose = useCallback(() => {
    if (onClose) {
      onClose();
    }
  }, [onClose]);

  // Unified scroll preservation helpers for consistent behavior
  const saveScrollPosition = useCallback((): { scrollPos: number; baseY: number; wasAtBottom: boolean } | null => {
    if (!xtermRef.current || isInAlternateBufferRef.current) {
      return null; // Don't save when in alternate buffer
    }
    const buffer = xtermRef.current.buffer.active;
    return {
      scrollPos: buffer.viewportY,
      baseY: buffer.baseY,
      wasAtBottom: buffer.viewportY >= buffer.baseY,
    };
  }, []);

  const restoreScrollPosition = useCallback((saved: { scrollPos: number; baseY: number; wasAtBottom: boolean } | null) => {
    if (!saved || !xtermRef.current || isInAlternateBufferRef.current) {
      return;
    }
    if (saved.wasAtBottom) {
      // User was at the bottom — scroll to bottom so the current prompt
      // is visible and reflowed lines are pushed into scrollback (iTerm-style).
      xtermRef.current.scrollToBottom();
    } else if (saved.scrollPos < saved.baseY) {
      xtermRef.current.scrollToLine(saved.scrollPos);
    }
  }, []);

  // Track previous column count to detect width changes
  const prevColsRef = useRef<number>(0);

  // Resize handler with debounce (preserves scroll position)
  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = setTimeout(() => {
      if (fitAddonRef.current && xtermRef.current) {
        const xterm = xtermRef.current;

        // Skip scroll preservation when in alternate buffer (TUI apps like Claude CLI)
        if (isInAlternateBufferRef.current) {
          fitAddonRef.current.fit();
          const { cols, rows } = xterm;
          prevColsRef.current = cols;
          window.terminalAPI.resize(sessionId, cols, rows).catch(console.error);
          return;
        }

        // Save scroll position before fit
        const saved = saveScrollPosition();
        const oldCols = prevColsRef.current;

        fitAddonRef.current.fit();

        const { cols, rows } = xterm;
        prevColsRef.current = cols;

        // When column count changes and user was at the bottom, push old
        // viewport lines into scrollback so only the current prompt is visible.
        // Newlines at the bottom row are the only reliable way to push to
        // scrollback in xterm.js (SU/ED discard lines instead).
        const buffer = xterm.buffer.active;
        if (oldCols > 0 && cols !== oldCols && saved?.wasAtBottom && buffer.cursorY > 0) {
          const linesToScroll = buffer.cursorY;
          // Move cursor to bottom row, write newlines to scroll content into
          // scrollback, then reposition cursor to top where the prompt now sits.
          xterm.write(
            `\x1b[${rows};1H` +          // CUP: cursor to bottom row
            '\n'.repeat(linesToScroll) +   // Newlines push top lines to scrollback
            `\x1b[H`                       // CUP: cursor to top-left (prompt is now here)
          );
        } else {
          restoreScrollPosition(saved);
        }

        window.terminalAPI.resize(sessionId, cols, rows).catch(console.error);
      }
    }, 100);
  }, [sessionId, saveScrollPosition, restoreScrollPosition]);

  // Initialize xterm.js
  useEffect(() => {
    if (!containerRef.current) return;

    // Build font family string with fallbacks
    const fontFamily = `"${settings.appearance.fontFamily}", Menlo, Monaco, "Courier New", monospace`;

    // Create terminal with settings
    const xterm = new XTerm({
      fontFamily,
      fontSize: settings.appearance.fontSize,
      lineHeight: 1.2,
      theme: xtermTheme,
      cursorBlink: settings.terminal.cursorBlink,
      cursorStyle: settings.terminal.cursorStyle,
      allowProposedApi: true,
      scrollback: settings.terminal.scrollbackLines,
      // Disable ligatures via font features if setting is off
      fontWeightBold: "bold",
    });

    // Load addons
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    // Load renderer addon based on GPU acceleration setting
    if (settings.advanced.gpuAcceleration) {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          webglAddonRef.current = null;
        });
        xterm.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch (e) {
        console.warn("WebGL addon not available, falling back to canvas renderer");
        try {
          const canvasAddon = new CanvasAddon();
          xterm.loadAddon(canvasAddon);
          canvasAddonRef.current = canvasAddon;
        } catch (e2) {
          console.warn("Canvas addon also not available");
        }
      }
    } else {
      // Use canvas renderer when GPU acceleration is disabled
      try {
        const canvasAddon = new CanvasAddon();
        xterm.loadAddon(canvasAddon);
        canvasAddonRef.current = canvasAddon;
      } catch (e) {
        console.warn("Canvas addon not available");
      }
    }

    // Load WebLinksAddon for clickable URLs (including file:// links)
    try {
      // Custom regex that matches http://, https://, and file:// URLs
      const urlRegex = /(?:https?|file):\/\/[^\s`'"()<>\[\]]+/;

      const webLinksAddon = new WebLinksAddon((event, uri) => {
        event.preventDefault();

        if (uri.startsWith('file://')) {
          // Handle file:// links - open in editor pane
          const filePath = uri.slice(7); // Remove "file://"
          const isDiff = event.shiftKey;
          if (onFileLinkRef.current) {
            onFileLinkRef.current(filePath, isDiff);
          }
        } else {
          // Open HTTP URLs in default browser via secure IPC
          window.terminalAPI.openExternal(uri).catch(console.error);
        }
      }, {
        urlRegex,
      });
      xterm.loadAddon(webLinksAddon);
      webLinksAddonRef.current = webLinksAddon;
    } catch (e) {
      console.warn("WebLinks addon not available:", e);
    }

    // Load ImageAddon for SIXEL and iTerm2 IIP (OSC 1337) inline images
    try {
      const imageAddon = new ImageAddon({
        enableSizeReports: true,
        pixelLimit: 16777216,      // 16MP max image size
        storageLimit: 128,         // 128MB cache for images
        showPlaceholder: true,     // Show placeholder while loading
        sixelSupport: true,        // Enable SIXEL protocol
        sixelScrolling: true,      // Allow scrolling with SIXEL
      });
      xterm.loadAddon(imageAddon);
      imageAddonRef.current = imageAddon;
    } catch (e) {
      console.warn("Image addon not available:", e);
    }

    // Load ClipboardAddon for OSC 52 clipboard sync (zellij, tmux, vim over SSH)
    try {
      const clipboardAddon = new ClipboardAddon();
      xterm.loadAddon(clipboardAddon);
      clipboardAddonRef.current = clipboardAddon;
    } catch (e) {
      console.warn("Clipboard addon not available:", e);
    }

    // Load SearchAddon for find functionality (Cmd/Ctrl+F)
    try {
      const searchAddon = new SearchAddon();
      xterm.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;
    } catch (e) {
      console.warn("Search addon not available:", e);
    }

    // Open terminal in container
    xterm.open(containerRef.current);
    fitAddon.fit();

    // Store refs
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Set up keyboard shortcut handler
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

    xterm.attachCustomKeyEventHandler((event) => {
      // Only handle keydown events
      if (event.type !== "keydown") return true;

      const isMod = isMac ? event.metaKey : event.ctrlKey;

      // Shift+Enter - insert newline (useful for multi-line input)
      if (event.shiftKey && event.key === "Enter" && !isMod) {
        event.preventDefault();
        window.terminalAPI.input(sessionId, "\n").catch(console.error);
        return false;
      }

      // Cmd/Ctrl+C - smart copy/SIGINT
      if (isMod && event.key === "c" && !event.shiftKey) {
        if (xterm.hasSelection()) {
          navigator.clipboard.writeText(xterm.getSelection());
          return false; // Prevent xterm handling, we copied
        }
        return true; // Let through for SIGINT (no selection)
      }

      // Cmd/Ctrl+Shift+C - always copy (alternative shortcut)
      if (isMod && event.shiftKey && event.key.toLowerCase() === "c") {
        const selection = xterm.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        return false;
      }

      // Cmd/Ctrl+V - paste
      if (isMod && event.key === "v" && !event.shiftKey) {
        event.preventDefault(); // Prevent browser's default paste
        navigator.clipboard.readText().then((text) => {
          if (text) {
            window.terminalAPI.input(sessionId, text).catch(console.error);
          }
        });
        return false;
      }

      // Cmd/Ctrl+Shift+V - paste (alternative shortcut, same behavior)
      if (isMod && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault(); // Prevent browser's default paste
        navigator.clipboard.readText().then((text) => {
          if (text) {
            window.terminalAPI.input(sessionId, text).catch(console.error);
          }
        });
        return false;
      }

      // Cmd/Ctrl+Shift+L - Add selection to Chat (context fragments)
      if (isMod && event.shiftKey && event.key.toLowerCase() === "l") {
        const sel = xterm.getSelection();
        if (sel) {
          if (onAddToChatRef.current) {
            onAddToChatRef.current(sessionId, sel);
          } else {
            window.terminalAPI.ideAddFragment(sessionId, sel);
          }
        }
        return false;
      }

      // Cmd/Ctrl+A - select all
      if (isMod && event.key === "a" && !event.shiftKey) {
        xterm.selectAll();
        selectionStateRef.current = null; // Clear keyboard selection state
        return false;
      }

      // Cmd/Ctrl+↑ - navigate to previous prompt (shell integration)
      if (isMod && event.key === "ArrowUp" && !event.shiftKey) {
        const marks = commandMarksRef.current;
        const currentViewport = xterm.buffer.active.viewportY;
        const cursorRow = xterm.buffer.active.cursorY + currentViewport;

        // Find the previous prompt-start mark before current cursor position
        const promptMarks = marks.filter(m => m.type === 'prompt-start' && m.row < cursorRow);
        if (promptMarks.length > 0) {
          const targetMark = promptMarks[promptMarks.length - 1];
          xterm.scrollToLine(targetMark.row);
          return false;
        }
        // No shell marks available (common in TUIs like Claude CLI): let the key through.
        return true;
      }

      // Cmd/Ctrl+↓ - navigate to next prompt (shell integration)
      if (isMod && event.key === "ArrowDown" && !event.shiftKey) {
        const marks = commandMarksRef.current;
        const currentViewport = xterm.buffer.active.viewportY;
        const cursorRow = xterm.buffer.active.cursorY + currentViewport;

        // Find the next prompt-start mark after current cursor position
        const promptMarks = marks.filter(m => m.type === 'prompt-start' && m.row > cursorRow);
        if (promptMarks.length > 0) {
          const targetMark = promptMarks[0];
          xterm.scrollToLine(targetMark.row);
          return false;
        }
        // No shell marks available (common in TUIs like Claude CLI): let the key through.
        return true;
      }

      // Shift+Arrow keys - keyboard selection
      if (event.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        const buffer = xterm.buffer.active;
        const cols = xterm.cols;
        const totalRows = buffer.length;

        // Helper to get character at position
        const getCharAt = (col: number, row: number): string => {
          const line = buffer.getLine(row);
          if (!line || col < 0 || col >= cols) return " ";
          const cell = line.getCell(col);
          return cell?.getChars() || " ";
        };

        // Helper to check if character is a word character
        const isWordChar = (char: string): boolean => /[\w]/.test(char);

        // Helper to find previous word boundary
        const findPrevWordBoundary = (col: number, row: number): { x: number; y: number } => {
          let x = col;
          let y = row;
          // Skip current word characters
          while ((x > 0 || y > 0) && isWordChar(getCharAt(x, y))) {
            x--;
            if (x < 0 && y > 0) {
              y--;
              x = cols - 1;
            }
          }
          // Skip non-word characters
          while ((x > 0 || y > 0) && !isWordChar(getCharAt(x, y))) {
            x--;
            if (x < 0 && y > 0) {
              y--;
              x = cols - 1;
            }
          }
          // Find start of word
          while (x > 0 && isWordChar(getCharAt(x - 1, y))) {
            x--;
          }
          return { x: Math.max(0, x), y };
        };

        // Helper to find next word boundary
        const findNextWordBoundary = (col: number, row: number): { x: number; y: number } => {
          let x = col;
          let y = row;
          // Skip current word characters
          while ((x < cols - 1 || y < totalRows - 1) && isWordChar(getCharAt(x, y))) {
            x++;
            if (x >= cols && y < totalRows - 1) {
              y++;
              x = 0;
            }
          }
          // Skip non-word characters
          while ((x < cols - 1 || y < totalRows - 1) && !isWordChar(getCharAt(x, y))) {
            x++;
            if (x >= cols && y < totalRows - 1) {
              y++;
              x = 0;
            }
          }
          return { x: Math.min(cols - 1, x), y };
        };

        // Initialize selection state if not exists
        if (!selectionStateRef.current) {
          // Start selection from cursor position
          const startX = buffer.cursorX;
          const startY = buffer.cursorY + buffer.viewportY;
          selectionStateRef.current = {
            anchor: { x: startX, y: startY },
            active: { x: startX, y: startY },
          };
        }

        const state = selectionStateRef.current;
        let { x, y } = state.active;

        // Word selection: Option+Shift on Mac, Ctrl+Shift on Windows/Linux
        const isWordMod = isMac ? event.altKey : event.ctrlKey;
        // Line jump: Cmd+Shift on Mac, use Home/End on Windows/Linux
        const isLineMod = isMac ? event.metaKey : false;

        // Move active position based on key
        switch (event.key) {
          case "ArrowLeft":
            if (isLineMod) {
              // Cmd+Shift+Left (Mac) - jump to start of line
              x = 0;
            } else if (isWordMod) {
              // Option+Shift+Left (Mac) or Ctrl+Shift+Left (Win/Linux) - word selection
              const boundary = findPrevWordBoundary(x, y);
              x = boundary.x;
              y = boundary.y;
            } else {
              x--;
              if (x < 0) {
                if (y > 0) {
                  y--;
                  x = cols - 1;
                } else {
                  x = 0;
                }
              }
            }
            break;
          case "ArrowRight":
            if (isLineMod) {
              // Cmd+Shift+Right (Mac) - jump to end of line
              x = cols - 1;
            } else if (isWordMod) {
              // Option+Shift+Right (Mac) or Ctrl+Shift+Right (Win/Linux) - word selection
              const boundary = findNextWordBoundary(x, y);
              x = boundary.x;
              y = boundary.y;
            } else {
              x++;
              if (x >= cols) {
                if (y < totalRows - 1) {
                  y++;
                  x = 0;
                } else {
                  x = cols - 1;
                }
              }
            }
            break;
          case "ArrowUp":
            if (isMod) {
              // Cmd/Ctrl+Shift+Up - jump to top of buffer
              y = 0;
            } else {
              y = Math.max(0, y - 1);
            }
            break;
          case "ArrowDown":
            if (isMod) {
              // Cmd/Ctrl+Shift+Down - jump to bottom of buffer
              y = totalRows - 1;
            } else {
              y = Math.min(totalRows - 1, y + 1);
            }
            break;
          case "Home":
            if (isMod) {
              // Cmd/Ctrl+Shift+Home - select to start of buffer
              x = 0;
              y = 0;
            } else {
              // Shift+Home - select to start of line
              x = 0;
            }
            break;
          case "End":
            if (isMod) {
              // Cmd/Ctrl+Shift+End - select to end of buffer
              x = cols - 1;
              y = totalRows - 1;
            } else {
              // Shift+End - select to end of line
              x = cols - 1;
            }
            break;
        }

        state.active = { x, y };

        // Apply selection - determine start and end points
        const anchor = state.anchor;
        const active = state.active;

        let startX: number, startY: number, endX: number, endY: number;
        if (anchor.y < active.y || (anchor.y === active.y && anchor.x <= active.x)) {
          startX = anchor.x;
          startY = anchor.y;
          endX = active.x;
          endY = active.y;
        } else {
          startX = active.x;
          startY = active.y;
          endX = anchor.x;
          endY = anchor.y;
        }

        // Calculate length for selection
        const length = (endY - startY) * cols + (endX - startX) + 1;
        xterm.select(startX, startY, length);

        return false; // Prevent default handling
      }

      // Any key without Shift clears keyboard selection state
      if (!event.shiftKey && selectionStateRef.current) {
        selectionStateRef.current = null;
      }

      return true; // Let all other keys through
    });

    // Set up input handler
    xterm.onData((data) => {
      window.terminalAPI.input(sessionId, data).catch(console.error);
    });

    // Set up binary input handler (for things like Ctrl+C)
    xterm.onBinary((data) => {
      window.terminalAPI.input(sessionId, data).catch(console.error);
    });

    // Listen for buffer changes (normal <-> alternate) for TUI apps like Claude CLI, vim, etc.
    const bufferChangeDisposable = xterm.buffer.onBufferChange((buffer) => {
      if (buffer.type === 'alternate') {
        // Entering alternate buffer - save normal buffer scroll position
        const normalBuffer = xterm.buffer.normal;
        savedNormalBufferScrollRef.current = {
          scrollPos: normalBuffer.viewportY,
          baseY: normalBuffer.baseY,
          wasAtBottom: normalBuffer.viewportY >= normalBuffer.baseY,
        };
        isInAlternateBufferRef.current = true;
      } else {
        // Returning to normal buffer - restore scroll position
        isInAlternateBufferRef.current = false;
        const saved = savedNormalBufferScrollRef.current;
        const normalBuffer = xterm.buffer.normal;

        requestAnimationFrame(() => {
          if (!saved) {
            return;
          }

          if (saved.wasAtBottom) {
            xterm.scrollToBottom();
          } else {
            // Clamp in case scrollback changed while in alternate buffer.
            const target = Math.max(0, Math.min(saved.scrollPos, normalBuffer.baseY));
            xterm.scrollToLine(target);
          }

          savedNormalBufferScrollRef.current = null;
        });
      }
    });

    // Clear keyboard selection state when mouse selection starts
    const handleMouseDown = () => {
      selectionStateRef.current = null;
    };
    containerRef.current?.addEventListener("mousedown", handleMouseDown);

    // Initial resize
    const { cols, rows } = xterm;
    window.terminalAPI.resize(sessionId, cols, rows).catch(console.error);

    // Focus terminal
    xterm.focus();

    // Clean up
    const container = containerRef.current;
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      container?.removeEventListener("mousedown", handleMouseDown);
      bufferChangeDisposable.dispose();
      webglAddonRef.current = null;
      canvasAddonRef.current = null;
      webLinksAddonRef.current = null;
      imageAddonRef.current?.dispose();
      imageAddonRef.current = null;
      clipboardAddonRef.current?.dispose();
      clipboardAddonRef.current = null;
      searchAddonRef.current?.dispose();
      searchAddonRef.current = null;
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  // IDE protocol: handle selection requests (fallback for direct tool queries)
  useEffect(() => {
    if (!xtermRef.current) return;

    // Listen for selection requests from IDE protocol server
    const cleanupSelectionRequest = window.terminalAPI.onIdeRequestSelection((requestId: string) => {
      const text = xtermRef.current?.getSelection() || "";
      window.terminalAPI.ideSelectionResponse(requestId, sessionId, text);
    });

    return () => {
      cleanupSelectionRequest();
    };
  }, [sessionId]);

  // Update terminal options when settings change (without recreating terminal)
  useEffect(() => {
    if (!xtermRef.current) return;

    const xterm = xtermRef.current;
    const fontFamily = `"${settings.appearance.fontFamily}", Menlo, Monaco, "Courier New", monospace`;

    // Update font settings
    xterm.options.fontFamily = fontFamily;
    xterm.options.fontSize = settings.appearance.fontSize;

    // Update cursor settings
    xterm.options.cursorBlink = settings.terminal.cursorBlink;
    xterm.options.cursorStyle = settings.terminal.cursorStyle;

    // Force cursor refresh by toggling focus (preserve scroll position)
    // Skip scroll preservation when in alternate buffer (TUI apps)
    if (isInAlternateBufferRef.current) {
      xterm.blur();
      xterm.focus();
    } else {
      const saved = saveScrollPosition();
      xterm.blur();
      xterm.focus();
      restoreScrollPosition(saved);
    }

    // Update theme
    xterm.options.theme = xtermTheme;

    // Refit after font changes (preserve scroll position)
    if (fitAddonRef.current) {
      // Skip scroll preservation when in alternate buffer (TUI apps)
      if (isInAlternateBufferRef.current) {
        setTimeout(() => {
          fitAddonRef.current?.fit();
        }, 10);
      } else {
        const saved = saveScrollPosition();
        setTimeout(() => {
          fitAddonRef.current?.fit();
          restoreScrollPosition(saved);
        }, 10);
      }
    }
  }, [
    settings.appearance.fontFamily,
    settings.appearance.fontSize,
    settings.terminal.cursorBlink,
    settings.terminal.cursorStyle,
    xtermTheme,
    saveScrollPosition,
    restoreScrollPosition,
  ]);

  // Set up message listener
  useEffect(() => {
    const cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as {
        type: string;
        sessionId?: string;
        data?: string;
        exitCode?: number;
        mark?: { type: string; exitCode?: number };
      };

      // Only handle messages for this session
      if (msg.sessionId && msg.sessionId !== sessionId) return;

      switch (msg.type) {
        case "output":
          if (msg.data) {
            // Decode base64 data with proper UTF-8 support
            const binaryString = atob(msg.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const decoded = textDecoder.decode(bytes);
            handleOutput(decoded);

            // Update current row for shell integration tracking
            if (xtermRef.current) {
              const buffer = xtermRef.current.buffer.active;
              currentRowRef.current = buffer.cursorY + buffer.baseY;
            }
          }
          break;

        case "session-closed":
          handleSessionClose();
          break;

        case "resize":
          // Backend confirmed resize, nothing to do
          break;

        case "command-mark":
          // Handle OSC 133 shell integration marks
          if (msg.mark && xtermRef.current) {
            const buffer = xtermRef.current.buffer.active;
            const currentRow = buffer.cursorY + buffer.baseY;

            // Add mark with current row position
            const newMark = {
              type: msg.mark.type as 'prompt-start' | 'command-start' | 'output-start' | 'command-end',
              row: currentRow,
              exitCode: msg.mark.exitCode,
            };
            commandMarksRef.current.push(newMark);

            // Limit stored marks to prevent memory growth (keep last 1000)
            if (commandMarksRef.current.length > 1000) {
              commandMarksRef.current = commandMarksRef.current.slice(-500);
            }
          }
          break;

        default:
          // Ignore unknown message types
          break;
      }
    });

    return cleanup;
  }, [sessionId, handleOutput, handleSessionClose]);

  // Set up typo suggestion listener
  useEffect(() => {
    if (!onTypoSuggestionChange) return;

    const cleanup = window.terminalAPI.onTypoSuggestion((data) => {
      if (data.sessionId === sessionId) {
        if (data.original && data.suggested && data.fullSuggestion && data.type) {
          onTypoSuggestionChange({
            original: data.original,
            suggested: data.suggested,
            fullSuggestion: data.fullSuggestion,
            type: data.type,
          });
        } else {
          onTypoSuggestionChange(null);
        }
      }
    });

    return cleanup;
  }, [sessionId, onTypoSuggestionChange]);

  // Set up autocomplete listener
  useEffect(() => {
    let pendingFrame: number | null = null;

    const cleanup = window.terminalAPI.onAutocomplete((data) => {
      if (data.sessionId === sessionId) {
        // Cancel any pending frame
        if (pendingFrame) {
          cancelAnimationFrame(pendingFrame);
          pendingFrame = null;
        }

        if (data.suggestion && data.ghostText && xtermRef.current) {
          // Capture suggestion before async callback (TypeScript can't track nullability across closures)
          const suggestion = data.suggestion;

          // Wait for next animation frame to ensure terminal has rendered
          pendingFrame = requestAnimationFrame(() => {
            if (!xtermRef.current) return;

            const xterm = xtermRef.current;
            const buffer = xterm.buffer.active;
            const cursorX = buffer.cursorX;
            const cursorY = buffer.cursorY;

            // Get cell dimensions
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const core = xterm as any;
            const cellWidth = core._core?._renderService?.dimensions?.css?.cell?.width ?? 8;
            const cellHeight = core._core?._renderService?.dimensions?.css?.cell?.height ?? 18;

            // xterm.js has 8px padding
            const xtermPadding = 8;

            // Extract just the subcommand from full suggestion (e.g., "stash" from "git stash")
            const parts = suggestion.split(' ');
            const subcommand = parts.length > 1 ? parts[parts.length - 1] : suggestion;

            setAutocompleteSuggestion({
              text: subcommand,
              // Position below the cursor line
              top: xtermPadding + (cursorY + 1) * cellHeight,
              // Align with cursor X position
              left: xtermPadding + cursorX * cellWidth,
            });
          });

          // Notify parent immediately (doesn't need position)
          if (onAutocompleteChange) {
            onAutocompleteChange({
              suggestion: data.suggestion,
              ghostText: data.ghostText,
            });
          }
        } else {
          // Clear immediately when no autocomplete
          setAutocompleteSuggestion(null);
          if (onAutocompleteChange) {
            onAutocompleteChange(null);
          }
        }
      }
    });

    return () => {
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame);
      }
      cleanup();
    };
  }, [sessionId, onAutocompleteChange]);

  // Set up container resize observer (for split pane resizing)
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(containerRef.current);

    // Also listen for window resize events from Electron
    const cleanup = window.terminalAPI.onWindowResize(handleResize);

    return () => {
      resizeObserver.disconnect();
      cleanup();
    };
  }, [handleResize]);

  // Handle scroll detection for auto-hiding scrollbar
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const showScrollbar = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1000);
    };

    // Wheel events for trackpad/mouse wheel scrolling
    const handleWheel = () => {
      showScrollbar();
    };

    // Also detect scrollbar drag via mousedown on the scrollbar area
    // and xterm viewport scroll events
    const handleScroll = () => {
      showScrollbar();
    };

    container.addEventListener("wheel", handleWheel, { passive: true });

    // Listen for scroll events on the xterm viewport
    const viewport = container.querySelector(".xterm-viewport");
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      container.removeEventListener("wheel", handleWheel);
      if (viewport) {
        viewport.removeEventListener("scroll", handleScroll);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle visibility changes (tab switching)
  useEffect(() => {
    if (isVisible && xtermRef.current && fitAddonRef.current) {
      // Skip scroll preservation when in alternate buffer (TUI apps)
      if (isInAlternateBufferRef.current) {
        setTimeout(() => {
          fitAddonRef.current?.fit();
        }, 50);
        return;
      }

      // Save scroll position before refit
      const saved = saveScrollPosition();

      // Refit when becoming visible
      setTimeout(() => {
        fitAddonRef.current?.fit();
        restoreScrollPosition(saved);
      }, 50);
    }
  }, [isVisible, saveScrollPosition, restoreScrollPosition]);

  // Handle focus changes (for split panes)
  useEffect(() => {
    if (isVisible && isFocused && xtermRef.current) {
      const xterm = xtermRef.current;
      // Only focus if not already focused (avoid unnecessary scroll adjustments)
      if (document.activeElement !== xterm.textarea) {
        // Skip scroll preservation when in alternate buffer (TUI apps)
        if (isInAlternateBufferRef.current) {
          setTimeout(() => {
            xterm.focus();
          }, 50);
          return;
        }

        // Save scroll position before focus
        const saved = saveScrollPosition();

        setTimeout(() => {
          xterm.focus();
          restoreScrollPosition(saved);
        }, 50);
      }
    }
  }, [isVisible, isFocused, saveScrollPosition, restoreScrollPosition]);

  // Notify parent when terminal receives focus
  useEffect(() => {
    if (!containerRef.current || !onFocus) return;

    const handleContainerFocus = () => {
      onFocus();
    };

    // Listen for focus on the container (bubbles up from xterm)
    containerRef.current.addEventListener("focusin", handleContainerFocus);

    return () => {
      containerRef.current?.removeEventListener("focusin", handleContainerFocus);
    };
  }, [onFocus]);

  // Terminal methods for context menu
  const terminalMethods = useMemo<TerminalMethods>(() => ({
    copy: () => {
      if (xtermRef.current) {
        const selection = xtermRef.current.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
      }
    },
    paste: async () => {
      if (xtermRef.current) {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            window.terminalAPI.input(sessionId, text).catch(console.error);
          }
        } catch (err) {
          console.error("Failed to paste:", err);
        }
      }
    },
    selectAll: () => {
      if (xtermRef.current) {
        xtermRef.current.selectAll();
      }
    },
    clear: () => {
      if (xtermRef.current) {
        xtermRef.current.clear();
      }
    },
    hasSelection: () => {
      if (xtermRef.current) {
        return xtermRef.current.hasSelection();
      }
      return false;
    },
    getSelection: () => {
      return xtermRef.current?.getSelection() || '';
    },
    findNext: (term: string, options?: SearchOptions) => {
      if (searchAddonRef.current && term) {
        return searchAddonRef.current.findNext(term, options);
      }
      return false;
    },
    findPrevious: (term: string, options?: SearchOptions) => {
      if (searchAddonRef.current && term) {
        return searchAddonRef.current.findPrevious(term, options);
      }
      return false;
    },
    clearSearch: () => {
      searchAddonRef.current?.clearDecorations();
    },
  }), [sessionId]);

  // Notify parent when methods are ready
  useEffect(() => {
    if (onMethodsReady) {
      onMethodsReady(terminalMethods);
    }
  }, [terminalMethods, onMethodsReady]);

  // Handle context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu(e, terminalMethods);
      }
    },
    [onContextMenu, terminalMethods]
  );

  // Drag and drop handlers - use native events with capture phase
  // because xterm.js creates its own DOM that intercepts events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragCounter = 0; // Track enter/leave for nested elements

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        setIsDragOver(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        setIsDragOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      setIsDragOver(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        // Convert files to escaped paths and join with spaces
        // Use Electron's webUtils API to get file paths (required for sandboxed renderer)
        const paths = Array.from(files)
          .map((f) => {
            const filePath = window.terminalAPI.getPathForFile(f);
            return escapePathForShell(filePath);
          })
          .join(" ");
        window.terminalAPI.input(sessionId, paths).catch(console.error);
      }
    };

    // Use capture phase to intercept events before xterm.js elements
    container.addEventListener("dragenter", handleDragEnter, true);
    container.addEventListener("dragover", handleDragOver, true);
    container.addEventListener("dragleave", handleDragLeave, true);
    container.addEventListener("drop", handleDrop, true);

    return () => {
      container.removeEventListener("dragenter", handleDragEnter, true);
      container.removeEventListener("dragover", handleDragOver, true);
      container.removeEventListener("dragleave", handleDragLeave, true);
      container.removeEventListener("drop", handleDrop, true);
    };
  }, [sessionId]);

  // "Add to Chat" floating button — show on mouseup with selection, hide on clear/type/scroll
  // Only shows when onAddToChat is provided (i.e. Claude pane is open with an active session)
  useEffect(() => {
    const container = containerRef.current;
    const xterm = xtermRef.current;
    if (!container || !xterm) return;

    const showButton = () => {
      requestAnimationFrame(() => {
        if (!onAddToChatRef.current) return;
        if (!xtermRef.current || !xtermRef.current.hasSelection()) return;
        if (!xtermRef.current.getSelection().trim()) return;
        const sel = xtermRef.current.getSelectionPosition();
        if (!sel) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const core = xtermRef.current as any;
        const cellWidth = core._core?._renderService?.dimensions?.css?.cell?.width ?? 8;
        const cellHeight = core._core?._renderService?.dimensions?.css?.cell?.height ?? 18;
        const xtermPadding = 8;
        const viewportY = xtermRef.current.buffer.active.viewportY;

        // Position below-right of selection end (sel coords are 1-based)
        let top = xtermPadding + (sel.end.y - viewportY - 1 + 1) * cellHeight + 4;
        const left = xtermPadding + (sel.end.x - 1) * cellWidth + 4;

        // If too close to the bottom, flip above selection start
        const containerHeight = container.clientHeight;
        if (top > containerHeight - 36) {
          top = xtermPadding + (sel.start.y - viewportY - 1) * cellHeight - 4 - 24;
        }

        setAddToChatBtn({ top, left });
      });
    };

    const hideButton = () => setAddToChatBtn(null);

    const handleMouseUp = () => showButton();
    const handleKeyDown = () => hideButton();
    // Show button when hovering over terminal with an existing selection
    const handleMouseEnter = () => {
      if (onAddToChatRef.current && xtermRef.current?.hasSelection()) showButton();
    };

    // Listen on document for mouseup so releases outside the terminal still trigger
    document.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("mouseenter", handleMouseEnter);

    // Hide when selection is cleared or becomes whitespace-only
    const selDisposable = xterm.onSelectionChange(() => {
      if (!xtermRef.current?.hasSelection() || !xtermRef.current.getSelection().trim()) hideButton();
    });

    // Hide on scroll (position would be stale)
    const viewport = container.querySelector(".xterm-viewport");
    const handleScroll = () => hideButton();
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("mouseenter", handleMouseEnter);
      selDisposable.dispose();
      if (viewport) {
        viewport.removeEventListener("scroll", handleScroll);
      }
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className={`terminal${isDragOver ? " drag-over" : ""}${isScrolling ? " scrolling" : ""}`}
      onContextMenu={handleContextMenu}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: theme.colors.background,
      }}
    >
      {/* Autocomplete tooltip - positioned below cursor like IntelliSense */}
      {autocompleteSuggestion && (
        <div
          className="autocomplete-tooltip"
          style={{
            top: `${autocompleteSuggestion.top}px`,
            left: `${autocompleteSuggestion.left}px`,
          }}
        >
          <span className="autocomplete-tooltip-text">{autocompleteSuggestion.text}</span>
          <span className="autocomplete-tooltip-hint">Tab</span>
        </div>
      )}

      {/* Floating "Add to Chat" button — appears near selected text */}
      {addToChatBtn && (
        <button
          className="add-to-chat-fab"
          style={{ top: addToChatBtn.top, left: addToChatBtn.left }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={() => {
            setAddToChatBtn(null);
            const text = xtermRef.current?.getSelection();
            if (text) {
              if (onAddToChatRef.current) {
                onAddToChatRef.current(sessionId, text);
              } else {
                window.terminalAPI.ideAddFragment(sessionId, text);
              }
            }
            xtermRef.current?.clearSelection();
          }}
          title="Add to Chat (\u21E7\u2318L)"
        >
          + Add to Chat
        </button>
      )}

    </div>
  );
}
