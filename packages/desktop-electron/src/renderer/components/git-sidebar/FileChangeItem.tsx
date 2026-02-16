/**
 * FileChangeItem Component
 *
 * Single file row in the git sidebar showing status, path, and stats.
 * Clicking the row opens/selects the file in the editor pane.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitFileChange } from "../smart-status-bar/types";
import { FileStatusIcon } from "./icons";

interface FileChangeItemProps {
  file: GitFileChange;
  selected?: boolean;
  onClick: () => void;
}

function formatPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return { dir: '', name: filePath };
  return { dir: filePath.substring(0, lastSlash + 1), name: filePath.substring(lastSlash + 1) };
}

function getDiffInfo(file: GitFileChange): { pct: number; color: string } | null {
  const net = file.additions - file.deletions;
  if (net === 0 && file.additions === 0) return null;

  const origLines = file.originalLines || 0;
  if (origLines <= 0) {
    // New file — no base to compute percentage; show nothing
    return null;
  }

  const rawPct = (net / origLines) * 100;
  const pct = Math.abs(rawPct) < 1 && net !== 0
    ? parseFloat(rawPct.toFixed(1))
    : Math.round(rawPct);
  return {
    pct,
    color: pct >= 0 ? 'var(--status-success)' : 'var(--status-error)',
  };
}

function formatPct(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '↑' : rounded < 0 ? '↓' : '';
  return `${sign}${Math.abs(rounded)}%`;
}

/** Easing: ease-out cubic — 1 - (1 - t)^3 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const ANIMATION_DURATION = 300; // ms

function AnimatedPercent({ value, color }: { value: number; color: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;

    if (from === to) return;

    const start = performance.now();
    const delta = to - from;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / ANIMATION_DURATION, 1);
      setDisplay(from + delta * easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return (
    <span className="git-sidebar-file-stats" style={{ color }}>
      {formatPct(display)}
    </span>
  );
}

export function FileChangeItem({ file, selected, onClick }: FileChangeItemProps) {
  const { dir, name } = formatPath(file.path);

  const handleClick = useCallback(() => {
    onClick();
  }, [onClick]);

  const diff = getDiffInfo(file);

  return (
    <div className="git-sidebar-file-item">
      <div className={`git-sidebar-file-row${selected ? ' selected' : ''}`} onClick={handleClick}>
        <FileStatusIcon status={file.status} size={18} />
        <span className="git-sidebar-file-path" title={file.path}>
          <span className="git-sidebar-file-path-inner">
            {dir && <span className="git-sidebar-file-dir">{dir}</span>}
            {name}
          </span>
        </span>
        {diff && <AnimatedPercent value={diff.pct} color={diff.color} />}
      </div>
    </div>
  );
}
