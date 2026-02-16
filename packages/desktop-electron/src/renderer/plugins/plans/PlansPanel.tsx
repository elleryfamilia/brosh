/**
 * PlansPanel — Plans sidebar panel
 *
 * Shows Claude Code plan files associated with the current project.
 * Plans are discovered via AI-powered indexing and can be dismissed.
 */

import { useCallback, useRef } from 'react';
import type { PanelProps } from '../types';
import { usePlansData } from './usePlansData';
import { PlansIcon } from './PlansIcon';
import type { PlanFileInfo } from '../../types/electron';

/** Format a relative timestamp from an ISO date string */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;

  // Show date for older items
  const date = new Date(isoDate);
  const month = date.toLocaleString('default', { month: 'short' });
  return `${month} ${date.getDate()}`;
}

export function PlansPanel({ context, width, onResize, onClose }: PanelProps) {
  const { workspace, isActive } = context;

  const focusedSessionIdRef = useRef(workspace.focusedSessionId);
  focusedSessionIdRef.current = workspace.focusedSessionId;
  const getFocusedSessionId = useCallback(() => focusedSessionIdRef.current, []);

  const gitRoot = workspace.git?.projectRoot ?? null;

  const { plans, loading, indexing, refresh, indexPlans, dismissPlan, resetIndex } = usePlansData({
    getFocusedSessionId,
    isActive,
    focusedSessionId: workspace.focusedSessionId,
    gitRoot,
  });

  const folderName = workspace.git?.projectRoot?.split('/').pop() ?? 'unknown';
  const headerTitle = `${folderName} - Plans`;

  const handlePlanClick = useCallback(
    (plan: PlanFileInfo) => {
      context.openFile(plan.absolutePath);
    },
    [context]
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent, filename: string) => {
      e.stopPropagation(); // don't open the file

      // If the dismissed plan is currently open, move to the next one
      const idx = plans.findIndex((p) => p.name === filename);
      const isOpen = idx >= 0 && context.editorFilePath === plans[idx].absolutePath;

      dismissPlan(filename).then(() => {
        if (!isOpen) return;
        // plans state will update async, so compute next from current list
        const remaining = plans.filter((p) => p.name !== filename);
        if (remaining.length > 0) {
          const nextIdx = Math.min(idx, remaining.length - 1);
          context.openFile(remaining[nextIdx].absolutePath);
        } else {
          context.closeEditor();
        }
      });
    },
    [dismissPlan, plans, context]
  );

  // Sidebar resize (right edge)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: width };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientX - resizeRef.current.startX;
        onResize(resizeRef.current.startWidth + delta);
      };
      const handleMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, onResize]
  );

  return (
    <div className="docs-panel" style={{ width }}>
      <div className="docs-panel-header">
        <div className="docs-panel-header-left">
          <PlansIcon size={14} />
          <span className="docs-panel-title">{headerTitle}</span>
        </div>
        <div className="docs-panel-actions">
          {plans.length > 0 && (
            <button
              className="docs-panel-btn"
              onClick={resetIndex}
              title="Reset index"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 2l12 12M14 2L2 14" />
              </svg>
            </button>
          )}
          <button
            className="docs-panel-btn"
            onClick={refresh}
            title="Refresh"
            type="button"
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v4h4" />
              <path d="M3.51 10a6 6 0 1 0 .49-5L1 8" />
            </svg>
          </button>
          <button
            className="docs-panel-btn"
            onClick={onClose}
            title="Close sidebar"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="docs-panel-body">
        {indexing && (
          <div className="plans-indexing-bar">
            <span className="plans-spinner" />
            Indexing plans with AI...
          </div>
        )}

        {plans.length > 0 ? (
          <div className="plans-list">
            {plans.map((plan, i) => (
              <button
                key={plan.name}
                className={`plans-row ${context.editorFilePath === plan.absolutePath ? 'plans-row--selected' : ''}`}
                onClick={() => handlePlanClick(plan)}
                type="button"
              >
                <div className="plans-row-main">
                  <span className="plans-row-title">
                    {plan.title || plan.name.replace(/\.md$/, '')}
                  </span>
                  <span className="plans-row-time">{formatRelativeTime(plan.mtime)}</span>
                </div>
                <div className="plans-row-meta">
                  <span className="plans-row-filename">{plan.name}</span>
                  {i === 0 && (
                    <span className="plans-latest-tag">Latest</span>
                  )}
                  <span
                    className="plans-dismiss-btn"
                    onClick={(e) => handleDismiss(e, plan.name)}
                    title="Dismiss plan"
                    role="button"
                    tabIndex={0}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <line x1="4" y1="4" x2="12" y2="12" />
                      <line x1="12" y1="4" x2="4" y2="12" />
                    </svg>
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : !loading && !indexing ? (
          <div className="plans-empty">
            <div className="plans-empty-text">No plans found for this project</div>
            <button
              className="plans-index-btn"
              onClick={indexPlans}
              type="button"
            >
              Index Plans
            </button>
          </div>
        ) : null}
      </div>

      {/* Resize handle (right edge) */}
      <div className="docs-panel-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  );
}
