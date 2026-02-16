/**
 * Markdown to ANSI Terminal Formatter
 *
 * Converts common markdown syntax to ANSI escape codes for terminal display.
 * Handles: bold, italic, code, code blocks, headers, bullets, blockquotes.
 *
 * Supports streaming mode for real-time formatting of AI responses.
 * Code blocks are syntax highlighted using cli-highlight.
 */

import { highlight, supportsLanguage } from "cli-highlight";

// ANSI escape codes
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  // Colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  // Bright colors
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  // Background
  bgGray: "\x1b[48;5;236m",
};

// Unicode characters for bullets
const BULLET = "•";
const BLOCK_QUOTE_BAR = "│";

/**
 * State for streaming markdown formatter.
 * Tracks code blocks and buffers partial lines.
 */
export interface MarkdownStreamState {
  inCodeBlock: boolean;
  codeBlockLang: string;
  codeBlockBuffer: string[];  // Buffer for code block lines
  lineBuffer: string;
}

/**
 * Create a new streaming state.
 */
export function createMarkdownStreamState(): MarkdownStreamState {
  return {
    inCodeBlock: false,
    codeBlockLang: "",
    codeBlockBuffer: [],
    lineBuffer: "",
  };
}

/**
 * Process a chunk of streaming markdown text.
 * Returns formatted text ready for terminal display (with \r\n line endings).
 */
export function processMarkdownChunk(
  chunk: string,
  state: MarkdownStreamState
): string {
  // Add chunk to buffer
  state.lineBuffer += chunk;

  // Find complete lines
  const lines = state.lineBuffer.split("\n");

  // Keep the last incomplete line in buffer
  state.lineBuffer = lines.pop() || "";

  // Format complete lines
  const result: string[] = [];
  for (const line of lines) {
    const formattedLines = formatMarkdownLine(line, state);
    result.push(...formattedLines);
  }

  // Join with \r\n for terminal display
  return result.length > 0 ? result.join("\r\n") + "\r\n" : "";
}

/**
 * Flush any remaining buffered content (call at end of stream).
 */
export function flushMarkdownStream(state: MarkdownStreamState): string {
  const result: string[] = [];

  // If we're still in a code block, output the buffered code
  if (state.inCodeBlock && state.codeBlockBuffer.length > 0) {
    const highlighted = highlightCode(state.codeBlockBuffer.join("\n"), state.codeBlockLang);
    result.push(...highlighted.split("\n"));
    result.push(`${ANSI.dim}${ANSI.cyan}───${ANSI.reset}`);
    state.codeBlockBuffer = [];
    state.inCodeBlock = false;
  }

  if (state.lineBuffer.length > 0) {
    const formattedLines = formatMarkdownLine(state.lineBuffer, state);
    result.push(...formattedLines);
    state.lineBuffer = "";
  }

  return result.join("\r\n");
}

/**
 * Highlight code using cli-highlight.
 */
function highlightCode(code: string, language: string): string {
  try {
    // Map common language aliases
    const langMap: Record<string, string> = {
      "js": "javascript",
      "ts": "typescript",
      "py": "python",
      "rb": "ruby",
      "sh": "bash",
      "shell": "bash",
      "zsh": "bash",
      "yml": "yaml",
      "md": "markdown",
      "jsx": "javascript",
      "tsx": "typescript",
    };

    const normalizedLang = langMap[language.toLowerCase()] || language.toLowerCase();

    // Check if language is supported
    if (language && supportsLanguage(normalizedLang)) {
      return highlight(code, { language: normalizedLang, ignoreIllegals: true });
    } else if (language) {
      // Try auto-detection if specified language isn't supported
      return highlight(code, { ignoreIllegals: true });
    } else {
      // No language specified, try auto-detection
      return highlight(code, { ignoreIllegals: true });
    }
  } catch {
    // Fallback to simple cyan coloring if highlighting fails
    return code.split("\n").map(line => `${ANSI.cyan}${line}${ANSI.reset}`).join("\n");
  }
}

/**
 * Format a single line of markdown, updating state for code blocks.
 * Returns an array of lines to output, or empty array if buffering.
 */
function formatMarkdownLine(
  line: string,
  state: MarkdownStreamState
): string[] {
  // Handle code blocks (```)
  if (line.trimStart().startsWith("```")) {
    if (!state.inCodeBlock) {
      // Starting a code block
      state.inCodeBlock = true;
      state.codeBlockLang = line.trim().slice(3).trim();
      state.codeBlockBuffer = [];
      // Add a subtle header for the code block
      if (state.codeBlockLang) {
        return [`${ANSI.dim}${ANSI.cyan}─── ${state.codeBlockLang} ───${ANSI.reset}`];
      } else {
        return [`${ANSI.dim}${ANSI.cyan}───${ANSI.reset}`];
      }
    } else {
      // Ending a code block - highlight and output the buffered code
      const code = state.codeBlockBuffer.join("\n");
      const highlighted = highlightCode(code, state.codeBlockLang);

      // Split highlighted code into lines and add closing delimiter
      const result = highlighted.split("\n");
      result.push(`${ANSI.dim}${ANSI.cyan}───${ANSI.reset}`);

      // Reset state
      state.inCodeBlock = false;
      state.codeBlockLang = "";
      state.codeBlockBuffer = [];

      return result;
    }
  }

  if (state.inCodeBlock) {
    // Inside code block - buffer the line for later highlighting
    state.codeBlockBuffer.push(line);
    return []; // Don't output yet
  }

  // Headers: # ## ### etc.
  const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const headerText = headerMatch[2];
    // Larger headers get brighter colors
    const color = level <= 2 ? ANSI.brightCyan : ANSI.cyan;
    return [`${ANSI.bold}${color}${headerText}${ANSI.reset}`];
  }

  // Blockquotes: > text
  if (line.trimStart().startsWith("> ")) {
    const quoteText = line.replace(/^\s*>\s?/, "");
    const formatted = formatInlineMarkdown(quoteText);
    return [`${ANSI.dim}${BLOCK_QUOTE_BAR} ${ANSI.italic}${formatted}${ANSI.reset}`];
  }

  // Unordered lists: - item, * item, + item
  const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (bulletMatch) {
    const indent = bulletMatch[1];
    const content = bulletMatch[3];
    const formatted = formatInlineMarkdown(content);
    return [`${indent}${ANSI.cyan}${BULLET}${ANSI.reset} ${formatted}`];
  }

  // Ordered lists: 1. item, 2. item
  const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (orderedMatch) {
    const indent = orderedMatch[1];
    const number = orderedMatch[2];
    const content = orderedMatch[3];
    const formatted = formatInlineMarkdown(content);
    return [`${indent}${ANSI.cyan}${number}.${ANSI.reset} ${formatted}`];
  }

  // Horizontal rule: ---, ***, ___
  if (/^[-*_]{3,}\s*$/.test(line.trim())) {
    return [`${ANSI.dim}${"─".repeat(40)}${ANSI.reset}`];
  }

  // Regular paragraph - apply inline formatting
  return [formatInlineMarkdown(line)];
}

/**
 * Format inline markdown elements (bold, italic, code, links).
 */
function formatInlineMarkdown(text: string): string {
  let result = text;

  // Inline code: `code` - must be done first to protect code from other formatting
  // Use a placeholder to protect code blocks from other transformations
  const codeBlocks: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`${ANSI.bgGray}${ANSI.cyan} ${code} ${ANSI.reset}`);
    return `\x00CODE${index}\x00`;
  });

  // Bold + Italic: ***text*** or ___text___
  result = result.replace(/(\*\*\*|___)([^*_]+)\1/g, `${ANSI.bold}${ANSI.italic}$2${ANSI.reset}`);

  // Bold: **text** or __text__
  result = result.replace(/(\*\*|__)([^*_]+)\1/g, `${ANSI.bold}$2${ANSI.reset}`);

  // Italic: *text* or _text_ (but not inside words for underscores)
  result = result.replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, `${ANSI.italic}$1${ANSI.reset}`);
  result = result.replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, `${ANSI.italic}$1${ANSI.reset}`);

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, `${ANSI.dim}$1${ANSI.reset}`);

  // Links: [text](url) - show text in blue, url in dim
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${ANSI.blue}${ANSI.underline}$1${ANSI.reset}${ANSI.dim} ($2)${ANSI.reset}`);

  // Restore code blocks
  codeBlocks.forEach((code, index) => {
    result = result.replace(`\x00CODE${index}\x00`, code);
  });

  return result;
}

/**
 * Format markdown text for terminal display with ANSI codes.
 * Non-streaming version for complete text.
 */
export function formatMarkdownForTerminal(text: string): string {
  const state = createMarkdownStreamState();
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const formattedLines = formatMarkdownLine(line, state);
    result.push(...formattedLines);
  }

  // Flush any remaining code block
  if (state.inCodeBlock && state.codeBlockBuffer.length > 0) {
    const highlighted = highlightCode(state.codeBlockBuffer.join("\n"), state.codeBlockLang);
    result.push(...highlighted.split("\n"));
  }

  return result.join("\n");
}
