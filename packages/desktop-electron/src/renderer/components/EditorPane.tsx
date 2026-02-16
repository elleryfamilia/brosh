/**
 * Editor Pane Component
 *
 * Monaco-based code editor with syntax highlighting, vim mode support,
 * and diff view capabilities. Integrates with the app's theme system.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Editor, { DiffEditor, Monaco, loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import type { editor } from "monaco-editor";
import { useSettings } from "../settings";
import { useMonacoTheme, getLanguageFromPath, registerCustomLanguages } from "../hooks/useMonacoTheme";
import type { DiffSource } from "../types/pane";

// Configure Monaco to use local version instead of CDN
loader.config({ monaco: monacoEditor });

interface EditorPaneProps {
  paneId: string;
  filePath: string;
  isDiff: boolean;
  diffSource?: DiffSource;
  isFocused: boolean;
  isVisible: boolean;
  onFocus: (paneId: string) => void;
  onClose: () => void;
}

export function EditorPane({
  paneId,
  filePath,
  isDiff,
  diffSource,
  isFocused,
  onFocus,
  onClose,
}: EditorPaneProps) {
  const { settings, theme } = useSettings();
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const vimModeRef = useRef<{ dispose: () => void } | null>(null);

  // Get the Monaco theme name
  const themeName = useMonacoTheme(monaco, theme);

  // Detect language from file path
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);

  // Extract filename for display
  const fileName = useMemo(() => {
    const parts = filePath.split("/");
    return parts[parts.length - 1] || filePath;
  }, [filePath]);

  // Load file content (only when file path changes)
  useEffect(() => {
    let cancelled = false;

    async function loadFile() {
      setLoading(true);
      setError(null);

      try {
        if (!isDiff) {
          // Plain file view
          const result = await window.terminalAPI.readFile(filePath);
          if (cancelled) return;
          if (!result.success) {
            setError(result.error || "Failed to read file");
            return;
          }
          setContent(result.content ?? "");
        } else if (diffSource && typeof diffSource === "object" && "oldContent" in diffSource && "newContent" in diffSource) {
          // Diff mode — inline content provided (e.g., from IDE protocol openDiff)
          if (cancelled) return;
          setOriginalContent(diffSource.oldContent);
          setContent(diffSource.newContent);
        } else if (diffSource && typeof diffSource === "object" && "commit" in diffSource) {
          // Diff mode — commit parent vs commit
          const commitHash = diffSource.commit;
          const [parentResult, commitResult] = await Promise.all([
            window.terminalAPI.gitShowFile(filePath, `${commitHash}~1`),
            window.terminalAPI.gitShowFile(filePath, commitHash),
          ]);
          if (cancelled) return;
          setOriginalContent(
            parentResult.success && parentResult.content ? parentResult.content : ""
          );
          setContent(
            commitResult.success && commitResult.content ? commitResult.content : ""
          );
        } else {
          // Diff mode — git HEAD vs current file on disk
          const [gitResult, diskResult] = await Promise.all([
            window.terminalAPI.gitShowFile(filePath, "HEAD"),
            window.terminalAPI.readFile(filePath),
          ]);
          if (cancelled) return;
          setOriginalContent(
            gitResult.success && gitResult.content ? gitResult.content : ""
          );
          if (!diskResult.success) {
            setError(diskResult.error || "Failed to read file");
            return;
          }
          setContent(diskResult.content ?? "");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadFile();

    return () => {
      cancelled = true;
    };
  }, [filePath, isDiff, diffSource]);

  // Handle Monaco mount
  const handleEditorMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
      editorRef.current = editor;
      registerCustomLanguages(monacoInstance);
      setMonaco(monacoInstance);

      // Set up vim mode if enabled
      if (settings.editor.vimMode) {
        import("monaco-vim").then(({ initVimMode }) => {
          // Create a status bar element for vim
          const statusNode = document.createElement("div");
          statusNode.className = "editor-vim-status";
          editor.getDomNode()?.parentElement?.appendChild(statusNode);

          const vimMode = initVimMode(editor, statusNode);
          vimModeRef.current = vimMode;
        }).catch((err) => {
          console.error("[EditorPane] Failed to load monaco-vim:", err);
        });
      }

      // Focus the editor
      editor.focus();
    },
    [settings.editor.vimMode]
  );

  // Handle diff editor mount
  const handleDiffEditorMount = useCallback(
    (editor: editor.IStandaloneDiffEditor, monacoInstance: Monaco) => {
      diffEditorRef.current = editor;
      registerCustomLanguages(monacoInstance);
      setMonaco(monacoInstance);

      // Focus the modified editor
      editor.getModifiedEditor().focus();
    },
    []
  );

  // Ensure diff editor models have the correct language applied.
  // The DiffEditor component from @monaco-editor/react doesn't reliably
  // apply the language prop on initial mount. This effect runs on the
  // re-render after setMonaco, when models are fully initialized.
  useEffect(() => {
    if (!isDiff || !monaco || !diffEditorRef.current) return;
    const diffModel = diffEditorRef.current.getModel();
    if (diffModel?.original) {
      monaco.editor.setModelLanguage(diffModel.original, language);
    }
    if (diffModel?.modified) {
      monaco.editor.setModelLanguage(diffModel.modified, language);
    }
  }, [monaco, language, isDiff]);

  // Clean up vim mode on unmount or when settings change
  useEffect(() => {
    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
        vimModeRef.current = null;
      }
    };
  }, []);

  // Toggle vim mode when setting changes
  useEffect(() => {
    if (!editorRef.current || !monaco) return;

    // Dispose existing vim mode
    if (vimModeRef.current) {
      vimModeRef.current.dispose();
      vimModeRef.current = null;
    }

    // Set up vim mode if enabled
    if (settings.editor.vimMode) {
      import("monaco-vim").then(({ initVimMode }) => {
        const editor = editorRef.current;
        if (!editor) return;

        // Find or create status bar
        let statusNode = editor.getDomNode()?.parentElement?.querySelector(".editor-vim-status");
        if (!statusNode) {
          statusNode = document.createElement("div");
          statusNode.className = "editor-vim-status";
          editor.getDomNode()?.parentElement?.appendChild(statusNode);
        }

        const vimMode = initVimMode(editor, statusNode as HTMLElement);
        vimModeRef.current = vimMode;
      }).catch((err) => {
        console.error("[EditorPane] Failed to load monaco-vim:", err);
      });
    }
  }, [settings.editor.vimMode, monaco]);

  // Handle click to focus
  const handleClick = useCallback(() => {
    onFocus(paneId);
  }, [paneId, onFocus]);

  // Copy file path to clipboard
  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(filePath);
  }, [filePath]);

  // Common editor options
  const editorOptions: editor.IStandaloneEditorConstructionOptions = useMemo(
    () => ({
      fontFamily: `"${settings.appearance.fontFamily}", Menlo, Monaco, "Courier New", monospace`,
      fontSize: settings.appearance.fontSize,
      lineHeight: 1.5,
      lineNumbers: settings.editor.lineNumbers ? "on" : "off",
      wordWrap: settings.editor.wordWrap ? "on" : "off",
      minimap: { enabled: settings.editor.minimap },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: true, // Editor is read-only for viewing
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      cursorBlinking: settings.terminal.cursorBlink ? "blink" : "solid",
      smoothScrolling: true,
      padding: { top: 8, bottom: 8 },
    }),
    [settings]
  );

  // Diff editor options
  const diffOptions: editor.IDiffEditorConstructionOptions = useMemo(
    () => ({
      ...editorOptions,
      renderSideBySide: true,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      originalEditable: false,
    }),
    [editorOptions]
  );

  // Build class names
  const paneClasses = [
    "editor-pane",
    isFocused ? "editor-pane-focused" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={paneClasses} onClick={handleClick}>
      {/* Header */}
      <div className="editor-pane-header">
        <div className="editor-pane-header-left">
          <span
            className="editor-pane-filename"
            onClick={handleCopyPath}
            title={`Click to copy: ${filePath}`}
          >
            {fileName}
          </span>
        </div>
        <div className="editor-pane-header-right">
          <span className="editor-pane-language">{language}</span>
          <button
            className="editor-pane-close"
            onClick={onClose}
            title="Close editor"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Editor content */}
      <div className="editor-pane-content">
        {loading && (
          <div className="editor-loading">
            Loading...
          </div>
        )}

        {error && (
          <div className="editor-error">
            <span className="editor-error-icon">!</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && (
          isDiff ? (
            <DiffEditor
              original={originalContent}
              modified={content}
              language={language}
              theme={themeName}
              options={diffOptions}
              onMount={handleDiffEditorMount}
            />
          ) : (
            <Editor
              value={content}
              language={language}
              theme={themeName}
              options={editorOptions}
              onMount={handleEditorMount}
            />
          )
        )}
      </div>

      {/* Vim status bar (populated by monaco-vim) */}
      {settings.editor.vimMode && !isDiff && (
        <div className="editor-vim-status-container" />
      )}
    </div>
  );
}
