/**
 * FilesEditorPanel — Writable Monaco editor for the Files plugin
 *
 * Rendered in the EditorPanel slot when the files plugin is active and
 * a file is opened. Supports editing, Cmd+S save, dirty tracking,
 * vim mode, and syntax highlighting via the app's theme system.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Editor, { type Monaco, loader } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor';
import type { editor } from 'monaco-editor';
import type { EditorPanelProps } from '../types';
import { useSettings } from '../../settings';
import { useMonacoTheme, getLanguageFromPath, registerCustomLanguages } from '../../hooks/useMonacoTheme';
import { FileIcon } from './FileIcon';

// Configure Monaco to use local version instead of CDN
loader.config({ monaco: monacoEditor });

export function FilesEditorPanel({ filePath, onClose }: EditorPanelProps) {
  const { settings, theme } = useSettings();
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const vimModeRef = useRef<{ dispose: () => void } | null>(null);
  const filePathRef = useRef(filePath);

  const themeName = useMonacoTheme(monaco, theme);
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);
  const fileName = useMemo(() => filePath.split('/').pop() || filePath, [filePath]);

  // Load file content when filePath changes
  useEffect(() => {
    filePathRef.current = filePath;
    setLoading(true);
    setDirty(false);

    window.terminalAPI
      .readFile(filePath)
      .then((result) => {
        if (filePathRef.current !== filePath) return;
        const text = result.success && result.content != null ? result.content : '';
        setContent(text);
        setSavedContent(text);
      })
      .catch(() => {
        if (filePathRef.current !== filePath) return;
        setContent('');
        setSavedContent('');
      })
      .finally(() => {
        if (filePathRef.current !== filePath) return;
        setLoading(false);
      });
  }, [filePath]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    const value = editorRef.current.getValue();
    try {
      const result = await window.terminalAPI.writeFile(filePath, value);
      if (result.success) {
        setSavedContent(value);
        setDirty(false);
      }
    } catch {
      // Save failed — keep dirty state
    }
  }, [filePath]);

  // Handle Monaco mount
  const handleEditorMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
      editorRef.current = editor;
      registerCustomLanguages(monacoInstance);
      setMonaco(monacoInstance);

      // Bind Cmd+S / Ctrl+S to save
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        () => handleSave()
      );

      // Set up vim mode if enabled
      if (settings.editor.vimMode) {
        import('monaco-vim').then(({ initVimMode }) => {
          const statusNode = document.createElement('div');
          statusNode.className = 'editor-vim-status';
          editor.getDomNode()?.parentElement?.appendChild(statusNode);

          const vimMode = initVimMode(editor, statusNode);
          vimModeRef.current = vimMode;
        }).catch((err) => {
          console.error('[FilesEditorPanel] Failed to load monaco-vim:', err);
        });
      }

      editor.focus();
    },
    [settings.editor.vimMode, handleSave]
  );

  // Track dirty state on change
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      setDirty(value !== savedContent);
    },
    [savedContent]
  );

  // Clean up vim mode on unmount
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

    if (vimModeRef.current) {
      vimModeRef.current.dispose();
      vimModeRef.current = null;
    }

    if (settings.editor.vimMode) {
      import('monaco-vim').then(({ initVimMode }) => {
        const editor = editorRef.current;
        if (!editor) return;

        let statusNode = editor.getDomNode()?.parentElement?.querySelector('.editor-vim-status');
        if (!statusNode) {
          statusNode = document.createElement('div');
          statusNode.className = 'editor-vim-status';
          editor.getDomNode()?.parentElement?.appendChild(statusNode);
        }

        const vimMode = initVimMode(editor, statusNode as HTMLElement);
        vimModeRef.current = vimMode;
      }).catch((err) => {
        console.error('[FilesEditorPanel] Failed to load monaco-vim:', err);
      });
    }
  }, [settings.editor.vimMode, monaco]);

  // Re-bind save command when filePath or savedContent changes
  useEffect(() => {
    if (!editorRef.current || !monaco) return;
    const disposable = editorRef.current.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSave()
    );
    return () => {
      // disposable may be null if keybinding already exists
      if (disposable) (disposable as unknown as { dispose?: () => void }).dispose?.();
    };
  }, [monaco, handleSave]);

  // Close with dirty check
  const handleClose = useCallback(() => {
    if (dirty) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [dirty, onClose]);

  const handleSaveAndClose = useCallback(async () => {
    await handleSave();
    setShowCloseConfirm(false);
    onClose();
  }, [handleSave, onClose]);

  const handleDiscardAndClose = useCallback(() => {
    setShowCloseConfirm(false);
    onClose();
  }, [onClose]);

  const editorOptions: editor.IStandaloneEditorConstructionOptions = useMemo(
    () => ({
      fontFamily: `"${settings.appearance.fontFamily}", Menlo, Monaco, "Courier New", monospace`,
      fontSize: settings.appearance.fontSize,
      lineHeight: 1.5,
      lineNumbers: settings.editor.lineNumbers ? 'on' : 'off',
      wordWrap: settings.editor.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.editor.minimap },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: false,
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      cursorBlinking: settings.terminal.cursorBlink ? 'blink' : 'solid',
      smoothScrolling: true,
      padding: { top: 8, bottom: 8 },
    }),
    [settings]
  );

  return (
    <div className="docs-editor-panel files-editor-panel">
      <div className="docs-editor-header files-editor-header">
        <div className="files-editor-header-left">
          <FileIcon filename={fileName} size={16} />
          <span className="docs-editor-filename" title={filePath}>
            {fileName}
            {dirty && <span className="docs-editor-dirty"> (modified)</span>}
          </span>
        </div>
        <button
          className="docs-panel-btn"
          onClick={handleClose}
          title="Close editor"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="docs-editor-empty">Loading...</div>
      ) : content !== null ? (
        <Editor
          value={content}
          language={language}
          theme={themeName}
          options={editorOptions}
          onMount={handleEditorMount}
          onChange={handleEditorChange}
        />
      ) : (
        <div className="docs-editor-empty">Failed to load file</div>
      )}

      {/* Unsaved changes confirmation modal */}
      {showCloseConfirm && (
        <div className="plans-confirm-overlay">
          <div className="plans-confirm-dialog">
            <div className="plans-confirm-title">Unsaved Changes</div>
            <div className="plans-confirm-message">
              <strong>{fileName}</strong> has unsaved changes. Do you want to save before closing?
            </div>
            <div className="plans-confirm-buttons">
              <button
                className="plans-confirm-btn plans-confirm-btn--cancel"
                onClick={() => setShowCloseConfirm(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="plans-confirm-btn plans-confirm-btn--cancel"
                onClick={handleDiscardAndClose}
                type="button"
              >
                Discard
              </button>
              <button
                className="plans-confirm-btn plans-confirm-btn--confirm"
                onClick={handleSaveAndClose}
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
