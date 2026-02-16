/**
 * MemorySection — Context memory file list
 *
 * Layout per the Figma design:
 *   [scope-tag-with-md-icon]  filename  [sparkle AUTO badge]
 *
 * Scope tag on the left (Project / Global), Auto badge on the right
 * when the file is auto-generated. Custom fixed-position tooltips on tags.
 */

import { useState, useCallback, useRef, type ReactNode } from 'react';
import type { MemoryFileInfo } from '../../types/electron';

interface MemorySectionProps {
  files: MemoryFileInfo[];
  selectedPath: string | null;
  onSelect: (absolutePath: string) => void;
}

/** ph:file-md — Phosphor markdown file icon (from Figma) */
function PhFileMd({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M83.46 32.16L61.59 10.29C61.3 10 60.95.77 60.57.61 60.19.46 59.79.37 59.38.37H21.88C20.22.37 18.63 1.03 17.46 2.21 16.28 3.38 15.63 4.97 15.63 6.63V43.75c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92s1.62-.33 2.21-.92c.59-.59.92-1.38.92-2.21V15.63H56.25V34.38c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92h18.75V87.5c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92s1.62-.33 2.21-.92c.59-.59.92-1.38.92-2.21V34.38c0-.41-.08-.82-.24-1.2-.16-.38-.39-.72-.68-1.02zM62.5 20.04L73.71 31.25H62.5V20.04zM56.25 56.25H50c-.83 0-1.62.33-2.21.92-.59.59-.92 1.38-.92 2.21v21.88c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92h6.25c3.73 0 7.31-1.48 9.94-4.12 2.64-2.64 4.12-6.21 4.12-9.94s-1.48-7.31-4.12-9.94c-2.64-2.64-6.21-4.12-9.94-4.12zm0 21.88h-3.13V62.5h3.13c2.07 0 4.06.82 5.52 2.29 1.47 1.47 2.29 3.45 2.29 5.52s-.82 4.06-2.29 5.52c-1.47 1.47-3.45 2.29-5.52 2.29zm-15.63-18.75v21.88c0 .83-.33 1.62-.92 2.21-.59.59-1.38.92-2.21.92s-1.62-.33-2.21-.92c-.59-.59-.92-1.38-.92-2.21V69.29l-5.24 7.5c-.29.41-.67.75-1.12.98-.45.23-.94.35-1.44.35s-.99-.12-1.44-.35c-.45-.23-.83-.57-1.12-.98L18.75 69.29V81.25c0 .83-.33 1.62-.92 2.21-.59.59-1.38.92-2.21.92s-1.62-.33-2.21-.92c-.59-.59-.92-1.38-.92-2.21V59.38c0-.66.21-1.31.61-1.85.39-.54.94-.93 1.58-1.13.63-.2 1.31-.19 1.94.01.63.21 1.18.62 1.56 1.17l8.38 11.97 8.38-11.97c.38-.54.93-.96 1.56-1.17.63-.21 1.31-.22 1.94-.01.63.2 1.18.59 1.58 1.13.39.54.61 1.19.61 1.85z" />
    </svg>
  );
}

/** ix:ai — sparkle/AI icon (from Figma) */
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 73 73" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M45.625 27.375L33.458 22.813 45.625 18.245 50.188 6.083l4.567 12.162L66.917 22.813 54.754 27.375 50.188 39.542 45.625 27.375zM21.292 51.708L6.083 45.625l15.209-6.083L27.375 24.333l6.083 15.209 15.209 6.083-15.209 6.083L27.375 66.917 21.292 51.708z" />
    </svg>
  );
}

type ScopeKind = 'project' | 'global';

function getScope(file: MemoryFileInfo): ScopeKind {
  switch (file.sourceKind) {
    case 'project':
    case 'project-local':
    case 'auto':
      return 'project';
    case 'user':
      return 'global';
    case 'rule':
      return file.isExternal ? 'global' : 'project';
  }
}

/* ------------------------------------------------------------------ */
/*  Fixed-position tooltip (escapes all overflow clipping)            */
/* ------------------------------------------------------------------ */

interface TooltipState {
  content: ReactNode;
  x: number;
  y: number;
}

const TOOLTIP_DELAY_MS = 200;
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = -4;
const SCREEN_PADDING = 12;

function useFixedTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = useCallback((content: ReactNode, e: React.MouseEvent) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTooltip({ content, x: e.clientX, y: e.clientY });
    }, TOOLTIP_DELAY_MS);
  }, []);

  const move = useCallback((e: React.MouseEvent) => {
    setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setTooltip(null);
  }, []);

  // Compute position, clamping to viewport
  let style: React.CSSProperties | undefined;
  if (tooltip) {
    let left = tooltip.x + CURSOR_OFFSET_X;
    let top = tooltip.y + CURSOR_OFFSET_Y;

    // Clamp: if tooltip would overflow right, flip to left of cursor
    const el = tooltipRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (left + rect.width > window.innerWidth - SCREEN_PADDING) {
        left = tooltip.x - rect.width - CURSOR_OFFSET_X;
      }
      if (top + rect.height > window.innerHeight - SCREEN_PADDING) {
        top = window.innerHeight - rect.height - SCREEN_PADDING;
      }
      if (left < SCREEN_PADDING) left = SCREEN_PADDING;
      if (top < SCREEN_PADDING) top = SCREEN_PADDING;
    }

    style = { left, top };
  }

  const element = tooltip ? (
    <div ref={tooltipRef} className="ctx-tooltip" style={style}>
      {tooltip.content}
    </div>
  ) : null;

  return { show, move, hide, element };
}

/* ------------------------------------------------------------------ */
/*  Tooltip content builders                                          */
/* ------------------------------------------------------------------ */

function scopeTooltipContent(scope: ScopeKind, path: string): ReactNode {
  const label = scope === 'project' ? 'Project context file' : 'Global context file';
  return (
    <>
      <span className="ctx-tooltip-label">{label}</span>
      <span className="ctx-tooltip-path">{path}</span>
    </>
  );
}

const autoTooltipContent = (
  <span className="ctx-tooltip-label">
    Automatically maintained by Claude across sessions
  </span>
);

/* ------------------------------------------------------------------ */
/*  MemorySection                                                     */
/* ------------------------------------------------------------------ */

export function MemorySection({ files, selectedPath, onSelect }: MemorySectionProps) {
  const { show, move, hide, element: tooltipEl } = useFixedTooltip();

  if (files.length === 0) return null;

  return (
    <div className="ctx-memory-section">
      <div className="ctx-section-header">
        Memory ({files.length})
      </div>
      <div className="ctx-memory-list">
        {files.map((file) => {
          const scope = getScope(file);
          const isAuto = file.sourceKind === 'auto';
          return (
            <button
              key={file.absolutePath}
              className={`ctx-memory-row${
                selectedPath === file.absolutePath ? ' ctx-memory-row--selected' : ''
              }`}
              onClick={() => onSelect(file.absolutePath)}
              type="button"
            >
              <span
                className={`ctx-scope-tag ctx-scope-tag--${scope}`}
                onMouseEnter={(e) => show(scopeTooltipContent(scope, file.absolutePath), e)}
                onMouseMove={move}
                onMouseLeave={hide}
              >
                <PhFileMd className="ctx-tag-icon" />
                {scope === 'project' ? 'Project' : 'Global'}
              </span>
              <span className="ctx-memory-name">{file.name}</span>
              {isAuto && (
                <span
                  className="ctx-auto-badge"
                  onMouseEnter={(e) => show(autoTooltipContent, e)}
                  onMouseMove={move}
                  onMouseLeave={hide}
                >
                  <SparkleIcon className="ctx-auto-sparkle" />
                  Auto
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tooltipEl}
    </div>
  );
}
