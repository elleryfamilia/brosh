/**
 * DocsEditorPanel — Custom editor panel for the docs plugin
 *
 * Rendered by App.tsx in the same slot as EditorPane when the docs plugin
 * is active and a file is open. Manages file loading/saving internally
 * and delegates editing to TiptapEditor.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { EditorPanelProps } from '../types';
import { TiptapEditor } from './TiptapEditor';

export function DocsEditorPanel({ filePath, onClose }: EditorPanelProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const filePathRef = useRef(filePath);

  // Load file content when filePath changes
  useEffect(() => {
    filePathRef.current = filePath;
    setLoading(true);
    setDirty(false);

    window.terminalAPI
      .readFile(filePath)
      .then((result) => {
        // Guard against stale responses
        if (filePathRef.current !== filePath) return;
        setMarkdown(result.success && result.content != null ? result.content : '');
      })
      .catch(() => {
        if (filePathRef.current !== filePath) return;
        setMarkdown('');
      })
      .finally(() => {
        if (filePathRef.current !== filePath) return;
        setLoading(false);
      });
  }, [filePath]);

  const handleSave = useCallback(
    async (md: string) => {
      try {
        const result = await window.terminalAPI.writeFile(filePath, md);
        if (result.success) setDirty(false);
      } catch {
        // Save failed — keep dirty state
      }
    },
    [filePath]
  );

  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);

  return (
    <div className="docs-editor-panel">
      {/* Header: filename + close button */}
      <div className="docs-editor-header">
        <span className="docs-editor-filename" title={filePath}>
          {fileName}
          {dirty && <span className="docs-editor-dirty"> (modified)</span>}
        </span>
        <button
          className="docs-panel-btn"
          onClick={onClose}
          title="Close editor"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* Editor content */}
      {loading ? (
        <div className="docs-editor-empty">Loading...</div>
      ) : markdown !== null ? (
        <TiptapEditor
          filePath={filePath}
          markdown={markdown}
          dirty={dirty}
          onDirtyChange={setDirty}
          onSave={handleSave}
        />
      ) : (
        <div className="docs-editor-empty">Failed to load file</div>
      )}
    </div>
  );
}
