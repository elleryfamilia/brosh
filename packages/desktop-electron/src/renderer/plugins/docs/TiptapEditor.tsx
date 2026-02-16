/**
 * TiptapEditor — WYSIWYG markdown editor wrapper
 *
 * Uses tiptap with tiptap-markdown for bidirectional markdown conversion.
 * Includes a formatting toolbar and save/discard controls that appear when dirty.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

interface TiptapEditorProps {
  filePath: string;
  markdown: string;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (markdown: string) => void;
}

function ToolbarButton({
  onClick,
  active = false,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`docs-toolbar-btn${active ? ' docs-toolbar-btn--active' : ''}`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="docs-toolbar-divider" />;
}

export function TiptapEditor({
  filePath,
  markdown,
  dirty,
  onDirtyChange,
  onSave,
}: TiptapEditorProps) {
  const initialContentRef = useRef(markdown);
  const filePathRef = useRef(filePath);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      Markdown,
    ],
    content: markdown,
    onUpdate: ({ editor: ed }) => {
      const current = (ed.storage as any).markdown.getMarkdown() as string;
      onDirtyChange(current !== initialContentRef.current);
    },
  });

  // When the file path changes, update the content
  useEffect(() => {
    if (!editor) return;
    if (filePath !== filePathRef.current) {
      filePathRef.current = filePath;
      initialContentRef.current = markdown;
      editor.commands.setContent(markdown);
      onDirtyChange(false);
    }
  }, [filePath, markdown, editor, onDirtyChange]);

  const handleSave = useCallback(() => {
    if (!editor || !dirty) return;
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    initialContentRef.current = md;
    onSave(md);
    onDirtyChange(false);
  }, [editor, dirty, onSave, onDirtyChange]);

  const handleDiscard = useCallback(() => {
    if (!editor) return;
    editor.commands.setContent(initialContentRef.current);
    onDirtyChange(false);
  }, [editor, onDirtyChange]);

  // Cmd+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handleSave]);

  if (!editor) return null;

  const isMac = navigator.platform.includes('Mac');

  return (
    <div className="docs-editor">
      {/* Formatting toolbar */}
      <div className="docs-toolbar">
        <div className="docs-toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
            title={`Bold (${isMac ? '\u2318B' : 'Ctrl+B'})`}
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
            title={`Italic (${isMac ? '\u2318I' : 'Ctrl+I'})`}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive('strike')}
            title="Strikethrough"
          >
            <s>S</s>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive('code')}
            title="Inline code"
          >
            <span className="docs-toolbar-mono">&lt;/&gt;</span>
          </ToolbarButton>
        </div>

        <ToolbarDivider />

        <div className="docs-toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          >
            H3
          </ToolbarButton>
        </div>

        <ToolbarDivider />

        <div className="docs-toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
            title="Bullet list"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="2.5" cy="4" r="1.3"/><rect x="6" y="3" width="9" height="2" rx="0.5"/><circle cx="2.5" cy="8" r="1.3"/><rect x="6" y="7" width="9" height="2" rx="0.5"/><circle cx="2.5" cy="12" r="1.3"/><rect x="6" y="11" width="9" height="2" rx="0.5"/></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
            title="Numbered list"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="0.5" y="5.5" fontSize="5" fontWeight="600" fontFamily="system-ui">1</text><rect x="6" y="3" width="9" height="2" rx="0.5"/><text x="0.5" y="9.5" fontSize="5" fontWeight="600" fontFamily="system-ui">2</text><rect x="6" y="7" width="9" height="2" rx="0.5"/><text x="0.5" y="13.5" fontSize="5" fontWeight="600" fontFamily="system-ui">3</text><rect x="6" y="11" width="9" height="2" rx="0.5"/></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive('taskList')}
            title="Task list"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="2" width="5" height="5" rx="1"/><polyline points="2.5,4.5 3.5,5.8 5.5,3"/><rect x="1" y="9" width="5" height="5" rx="1"/><line x1="8" y1="4.5" x2="15" y2="4.5"/><line x1="8" y1="11.5" x2="15" y2="11.5"/></svg>
          </ToolbarButton>
        </div>

        <ToolbarDivider />

        <div className="docs-toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
            title="Blockquote"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h2.5c.5 0 1 .5 1 1v3c0 .5-.5 1-1 1H3v2.5c0 .3-.2.5-.5.5S2 10.8 2 10.5V4c0-.5.5-1 1-1zm6.5 0H12c.5 0 1 .5 1 1v3c0 .5-.5 1-1 1H9.5v2.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5V4c0-.5.5-1 1-1z"/></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive('codeBlock')}
            title="Code block"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4.5,4 1.5,8 4.5,12"/><polyline points="11.5,4 14.5,8 11.5,12"/><line x1="9.5" y1="2.5" x2="6.5" y2="13.5"/></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal rule"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1" y1="8" x2="15" y2="8"/></svg>
          </ToolbarButton>
        </div>

        {/* Save/discard — only when dirty */}
        {dirty && (
          <>
            <div className="docs-toolbar-spacer" />
            <div className="docs-toolbar-group docs-toolbar-save-group">
              <button
                className="docs-toolbar-discard"
                onClick={handleDiscard}
                title="Discard changes"
                type="button"
              >
                Discard
              </button>
              <button
                className="docs-toolbar-save"
                onClick={handleSave}
                title={`Save (${isMac ? '\u2318S' : 'Ctrl+S'})`}
                type="button"
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>

      {/* Editor content */}
      <div className="docs-editor-content">
        <EditorContent editor={editor} className="docs-tiptap" />
      </div>
    </div>
  );
}
