/**
 * Monaco Theme Hook
 *
 * Converts the app's Theme type to Monaco editor theme format
 * and auto-updates when the theme changes.
 */

import { useEffect, useRef } from "react";
import type { editor } from "monaco-editor";
import type { Theme } from "../settings";

/**
 * Converts an app Theme to a Monaco theme definition
 */
function createMonacoTheme(theme: Theme): editor.IStandaloneThemeData {
  const { colors } = theme;

  return {
    base: theme.isDark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      // Comments
      { token: "comment", foreground: colors.ansi.brightBlack, fontStyle: "italic" },
      { token: "comment.line", foreground: colors.ansi.brightBlack },
      { token: "comment.block", foreground: colors.ansi.brightBlack },

      // Strings
      { token: "string", foreground: colors.ansi.green },
      { token: "string.escape", foreground: colors.ansi.cyan },
      { token: "string.regexp", foreground: colors.ansi.red },

      // Numbers
      { token: "number", foreground: colors.ansi.magenta },
      { token: "number.hex", foreground: colors.ansi.magenta },

      // Keywords
      { token: "keyword", foreground: colors.ansi.blue, fontStyle: "bold" },
      { token: "keyword.control", foreground: colors.ansi.magenta },
      { token: "keyword.operator", foreground: colors.ansi.cyan },

      // Types
      { token: "type", foreground: colors.ansi.yellow },
      { token: "type.identifier", foreground: colors.ansi.yellow },

      // Functions
      { token: "function", foreground: colors.ansi.blue },
      { token: "function.declaration", foreground: colors.ansi.blue },

      // Variables
      { token: "variable", foreground: colors.foreground },
      { token: "variable.predefined", foreground: colors.ansi.cyan },
      { token: "variable.parameter", foreground: colors.ansi.red },

      // Constants
      { token: "constant", foreground: colors.ansi.magenta },
      { token: "constant.language", foreground: colors.ansi.magenta, fontStyle: "bold" },

      // Operators
      { token: "operator", foreground: colors.ansi.cyan },
      { token: "delimiter", foreground: colors.foreground },
      { token: "delimiter.bracket", foreground: colors.foreground },

      // Tags (HTML/XML)
      { token: "tag", foreground: colors.ansi.red },
      { token: "tag.attribute.name", foreground: colors.ansi.yellow },
      { token: "tag.attribute.value", foreground: colors.ansi.green },

      // Markup
      { token: "markup.heading", foreground: colors.ansi.blue, fontStyle: "bold" },
      { token: "markup.bold", fontStyle: "bold" },
      { token: "markup.italic", fontStyle: "italic" },
      { token: "markup.underline", fontStyle: "underline" },

      // Diff
      { token: "inserted", foreground: colors.ansi.green },
      { token: "deleted", foreground: colors.ansi.red },
      { token: "changed", foreground: colors.ansi.yellow },
    ],
    colors: {
      // Editor background and foreground
      "editor.background": colors.background,
      "editor.foreground": colors.foreground,

      // Selection
      "editor.selectionBackground": colors.accent + "40",
      "editor.inactiveSelectionBackground": colors.accent + "20",
      "editor.selectionHighlightBackground": colors.accent + "20",

      // Current line
      "editor.lineHighlightBackground": colors.surface1,
      "editor.lineHighlightBorder": colors.surface2,

      // Cursor
      "editorCursor.foreground": colors.accent,
      "editorCursor.background": colors.background,

      // Line numbers
      "editorLineNumber.foreground": colors.ansi.brightBlack,
      "editorLineNumber.activeForeground": colors.foreground,

      // Indent guides
      "editorIndentGuide.background": colors.surface1,
      "editorIndentGuide.activeBackground": colors.surface2,

      // Bracket matching
      "editorBracketMatch.background": colors.accent + "30",
      "editorBracketMatch.border": colors.accent,

      // Word highlight
      "editor.wordHighlightBackground": colors.accent + "20",
      "editor.wordHighlightStrongBackground": colors.accent + "30",

      // Find match
      "editor.findMatchBackground": colors.warning + "40",
      "editor.findMatchHighlightBackground": colors.warning + "20",

      // Gutter
      "editorGutter.background": colors.background,
      "editorGutter.modifiedBackground": colors.warning,
      "editorGutter.addedBackground": colors.success,
      "editorGutter.deletedBackground": colors.error,

      // Minimap
      "minimap.background": colors.surface0,
      "minimap.selectionHighlight": colors.accent + "80",

      // Scrollbar
      "scrollbarSlider.background": colors.surface2 + "60",
      "scrollbarSlider.hoverBackground": colors.surface2 + "80",
      "scrollbarSlider.activeBackground": colors.surface2 + "a0",

      // Diff editor
      "diffEditor.insertedTextBackground": colors.success + "20",
      "diffEditor.removedTextBackground": colors.error + "20",
      "diffEditor.insertedLineBackground": colors.success + "10",
      "diffEditor.removedLineBackground": colors.error + "10",

      // Widget backgrounds
      "editorWidget.background": colors.surface1,
      "editorWidget.border": colors.border,
      "editorWidget.foreground": colors.foreground,

      // Hover widget
      "editorHoverWidget.background": colors.surface1,
      "editorHoverWidget.border": colors.border,

      // Suggest widget (autocomplete)
      "editorSuggestWidget.background": colors.surface1,
      "editorSuggestWidget.border": colors.border,
      "editorSuggestWidget.foreground": colors.foreground,
      "editorSuggestWidget.selectedBackground": colors.accent + "40",
      "editorSuggestWidget.highlightForeground": colors.accent,

      // Input (search, etc)
      "input.background": colors.surface0,
      "input.foreground": colors.foreground,
      "input.border": colors.border,
      "input.placeholderForeground": colors.ansi.brightBlack,
      "inputOption.activeBackground": colors.accent + "40",
      "inputOption.activeBorder": colors.accent,
    },
  };
}

/**
 * Hook that manages Monaco theme registration and updates
 * Returns the theme name to use with Monaco editor
 */
export function useMonacoTheme(
  monaco: typeof import("monaco-editor") | null,
  theme: Theme
): string {
  const themeNameRef = useRef<string>(`app-theme-${theme.id}`);

  useEffect(() => {
    if (!monaco) return;

    const themeName = `app-theme-${theme.id}`;
    const monacoTheme = createMonacoTheme(theme);

    // Define/update the theme in Monaco
    monaco.editor.defineTheme(themeName, monacoTheme);

    // Update all editors to use the new theme
    monaco.editor.setTheme(themeName);

    themeNameRef.current = themeName;
  }, [monaco, theme]);

  return themeNameRef.current;
}

/**
 * Register custom languages that Monaco doesn't include natively.
 * Call once after Monaco is loaded.
 */
let customLanguagesRegistered = false;
export function registerCustomLanguages(monaco: typeof import("monaco-editor")): void {
  if (customLanguagesRegistered) return;
  customLanguagesRegistered = true;

  // TOML
  monaco.languages.register({ id: "toml" });
  monaco.languages.setMonarchTokensProvider("toml", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/\[\[[\w.\-]+\]\]/, "type.identifier"],
        [/\[[\w.\-]+\]/, "type.identifier"],
        [/[\w.\-]+(?=\s*=)/, "variable"],
        [/=/, "delimiter"],
        [/"""/, { token: "string", next: "@multiLineString" }],
        [/"/, { token: "string", next: "@string" }],
        [/'''/, { token: "string", next: "@multiLineLiteral" }],
        [/'/, { token: "string", next: "@literal" }],
        [/\b(true|false)\b/, "keyword"],
        [/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/, "number.date"],
        [/-?\d+\.\d+([eE][+-]?\d+)?/, "number.float"],
        [/-?0[xX][0-9a-fA-F_]+/, "number.hex"],
        [/-?0[oO][0-7_]+/, "number.octal"],
        [/-?0[bB][01_]+/, "number.binary"],
        [/-?\d[\d_]*/, "number"],
      ],
      string: [
        [/[^"\\]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string", next: "@pop" }],
      ],
      literal: [
        [/[^']+/, "string"],
        [/'/, { token: "string", next: "@pop" }],
      ],
      multiLineString: [
        [/[^"\\]+/, "string"],
        [/\\./, "string.escape"],
        [/"""/, { token: "string", next: "@pop" }],
        [/"/, "string"],
      ],
      multiLineLiteral: [
        [/[^']+/, "string"],
        [/'''/, { token: "string", next: "@pop" }],
        [/'/, "string"],
      ],
    },
  });

  // Slint UI language
  monaco.languages.register({ id: "slint" });
  monaco.languages.setMonarchTokensProvider("slint", {
    keywords: [
      "import", "from", "export", "component", "inherits", "global", "struct",
      "enum", "property", "in", "out", "in-out", "private", "callback",
      "animate", "states", "transitions", "if", "else", "for", "return",
      "pure", "public", "function",
    ],
    typeKeywords: [
      "int", "float", "string", "bool", "color", "brush", "length", "duration",
      "physical-length", "angle", "relative-font-size", "image", "percent",
      "easing",
    ],
    builtinElements: [
      "Window", "Rectangle", "Text", "Image", "TouchArea", "FocusScope",
      "Flickable", "GridLayout", "HorizontalLayout", "VerticalLayout",
      "Dialog", "PopupWindow", "Timer", "Path", "TextInput", "ListView",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, { token: "comment", next: "@blockComment" }],
        [/"/, { token: "string", next: "@string" }],
        [/#[0-9a-fA-F]{3,8}\b/, "number.hex"],
        [/\d+(\.\d+)?(px|pt|ms|s|%|deg|rem|phx|turn)?\b/, "number"],
        [/@[a-zA-Z_]\w*/, "annotation"],
        [/[a-zA-Z_][\w-]*(?=\s*\{)/, {
          cases: {
            "@builtinElements": "type.identifier",
            "@default": "type",
          },
        }],
        [/[a-zA-Z_][\w-]*/, {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "type.identifier",
            "@default": "identifier",
          },
        }],
        [/<=>|<->|=>|:=|[{}()\[\]:;,.]/, "delimiter"],
        [/<\w+>/, "type.identifier"],
      ],
      string: [
        [/[^"\\]+/, "string"],
        [/\\[\\nrt"]/, "string.escape"],
        [/\\\{/, { token: "string.escape", next: "@stringInterp" }],
        [/"/, { token: "string", next: "@pop" }],
      ],
      stringInterp: [
        [/\}/, { token: "string.escape", next: "@pop" }],
        { include: "root" },
      ],
      blockComment: [
        [/[^/*]+/, "comment"],
        [/\/\*/, { token: "comment", next: "@push" }],
        [/\*\//, { token: "comment", next: "@pop" }],
        [/[/*]/, "comment"],
      ],
    },
  });

  // Zig
  monaco.languages.register({ id: "zig" });
  monaco.languages.setMonarchTokensProvider("zig", {
    keywords: [
      "addrspace", "align", "allowzero", "and", "anyframe", "anytype", "asm",
      "async", "await", "break", "callconv", "catch", "comptime", "const",
      "continue", "defer", "else", "enum", "errdefer", "error", "export",
      "extern", "fn", "for", "if", "inline", "linksection", "noalias",
      "nosuspend", "opaque", "or", "orelse", "packed", "pub", "resume",
      "return", "struct", "suspend", "switch", "test", "threadlocal", "try",
      "union", "unreachable", "usingnamespace", "var", "volatile", "while",
    ],
    builtinTypes: [
      "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "i128", "u128",
      "isize", "usize", "f16", "f32", "f64", "f80", "f128",
      "bool", "void", "noreturn", "type", "anyerror", "comptime_int",
      "comptime_float", "anyopaque",
    ],
    constants: ["null", "undefined", "true", "false"],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\\\\.*$/, "string"],
        [/"/, { token: "string", next: "@string" }],
        [/'[^'\\]'/, "string"],
        [/'\\.'/, "string.escape"],
        [/@"/, { token: "string", next: "@rawString" }],
        [/@[a-zA-Z_]\w*/, "annotation"],
        [/\b0x[0-9a-fA-F_]+\b/, "number.hex"],
        [/\b0o[0-7_]+\b/, "number.octal"],
        [/\b0b[01_]+\b/, "number.binary"],
        [/\b\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?\b/, "number"],
        [/[a-zA-Z_]\w*/, {
          cases: {
            "@keywords": "keyword",
            "@builtinTypes": "type.identifier",
            "@constants": "keyword",
            "@default": "identifier",
          },
        }],
        [/[{}()\[\]]/, "delimiter.bracket"],
        [/[<>!=]=?|[+\-*/%&|^~]|\.{2,3}|\+\+|<<|>>/, "operator"],
        [/[;,.:?]/, "delimiter"],
      ],
      string: [
        [/[^"\\]+/, "string"],
        [/\\[\\nrt'"]/, "string.escape"],
        [/\\x[0-9a-fA-F]{2}/, "string.escape"],
        [/\\u\{[0-9a-fA-F]+\}/, "string.escape"],
        [/"/, { token: "string", next: "@pop" }],
      ],
      rawString: [
        [/[^"]+/, "string"],
        [/"/, { token: "string", next: "@pop" }],
      ],
    },
  });
}

/**
 * Get language ID from file extension
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  const extensionMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    mts: "typescript",
    cts: "typescript",

    // Web
    html: "html",
    htm: "html",
    xhtml: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    json: "json",
    jsonc: "json",
    json5: "json",
    pug: "pug",
    jade: "pug",

    // Python
    py: "python",
    pyw: "python",
    pyi: "python",

    // Shell / scripting
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    ksh: "shell",
    ps1: "powershell",
    psm1: "powershell",
    psd1: "powershell",
    bat: "bat",
    cmd: "bat",

    // Systems
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hh: "cpp",
    hxx: "cpp",
    rs: "rust",
    go: "go",
    zig: "zig", // custom tokenizer

    // JVM
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    scala: "scala",

    // .NET
    cs: "csharp",
    csx: "csharp",
    fs: "fsharp",
    fsx: "fsharp",
    vb: "vb",

    // Ruby
    rb: "ruby",
    erb: "ruby",
    rake: "ruby",
    gemspec: "ruby",

    // PHP
    php: "php",

    // Swift/Objective-C
    swift: "swift",
    m: "objective-c",
    mm: "objective-c",

    // Dart
    dart: "dart",

    // Config / data formats
    yaml: "yaml",
    yml: "yaml",
    toml: "toml", // custom tokenizer registered below
    ini: "ini",
    conf: "ini",
    cfg: "ini",
    env: "ini",
    properties: "ini",
    xml: "xml",
    xsd: "xml",
    xsl: "xml",
    xslt: "xml",
    svg: "xml",
    plist: "xml",
    xaml: "xml",
    csproj: "xml",
    fsproj: "xml",
    sln: "xml",
    vcxproj: "xml",

    // Infrastructure / DevOps
    tf: "hcl",
    tfvars: "hcl",
    hcl: "hcl",

    // Data / query
    sql: "sql",
    mysql: "mysql",
    pgsql: "pgsql",
    graphql: "graphql",
    gql: "graphql",
    proto: "protobuf",

    // Markdown
    md: "markdown",
    mdx: "mdx",
    markdown: "markdown",

    // Functional / other languages
    r: "r",
    lua: "lua",
    perl: "perl",
    pl: "perl",
    pm: "perl",
    clj: "clojure",
    cljs: "clojure",
    cljc: "clojure",
    edn: "clojure",
    ex: "elixir",
    exs: "elixir",
    ml: "fsharp",
    mli: "fsharp",
    jl: "julia",
    tcl: "tcl",
    sol: "solidity",
    wgsl: "wgsl",
    pas: "pascal",

    // Templating
    liquid: "liquid",
    hbs: "handlebars",
    handlebars: "handlebars",
    twig: "twig",
    razor: "razor",
    cshtml: "razor",

    // Other
    dockerfile: "dockerfile",
    diff: "plaintext",
    patch: "plaintext",

    // Custom tokenizer languages
    slint: "slint",
  };

  // Check for special filenames (before extension lookup)
  const filename = filePath.split("/").pop()?.toLowerCase() || "";
  if (filename === "dockerfile" || filename.startsWith("dockerfile.")) return "dockerfile";
  if (filename === "makefile" || filename === "gnumakefile") return "shell";
  if (filename === "cmakelists.txt") return "plaintext";
  if (filename === "cargo.lock") return "toml";
  if (filename === "gemfile" || filename === "rakefile") return "ruby";
  if (filename === "vagrantfile") return "ruby";
  if (filename === ".eslintrc" || filename === ".prettierrc" || filename === ".babelrc") return "json";
  if (filename.startsWith(".") && filename.endsWith("rc")) return "shell";
  if (filename.endsWith(".lock") && !ext) return "plaintext";

  return extensionMap[ext] || "plaintext";
}
