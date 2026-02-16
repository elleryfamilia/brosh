/**
 * CommitGraphCell Component
 *
 * Renders the graph column for a single commit row.
 * Uses CSS divs for vertical rails (stretch with row height)
 * and two SVGs for curves: one fixed-height for incoming merges (above dot),
 * one stretchy for outgoing branches (below dot).
 * The dot is pinned at NODE_Y so it stays aligned with the commit header.
 */

import type { GraphRow } from "./graph-layout";
import { COL_SPACING, NODE_SIZE, LINE_WIDTH, LEFT_PAD, NODE_Y } from "./graph-layout";

interface CommitGraphCellProps {
  row: GraphRow;
}

function colX(col: number): number {
  return LEFT_PAD + col * COL_SPACING;
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function CommitGraphCell({ row }: CommitGraphCellProps) {
  const width = LEFT_PAD + row.maxColumns * COL_SPACING;
  const nodeX = colX(row.nodeCol);
  const hasIncoming = row.incomingMerges.length > 0;
  const hasOutgoing = row.outgoingBranches.length > 0;

  return (
    <div className="commit-graph-cell" style={{ width }}>
      {/* Pass-through rails (full height) */}
      {row.passThroughs.map((pt) => (
        <div
          key={`pt-${pt.col}`}
          className="commit-graph-rail"
          style={{
            left: colX(pt.col) - LINE_WIDTH / 2,
            backgroundColor: pt.color,
            width: LINE_WIDTH,
          }}
        />
      ))}

      {/* Node column: above rail (top to dot) */}
      {row.hasLineAbove && (
        <div
          className="commit-graph-rail commit-graph-rail-above"
          style={{
            left: nodeX - LINE_WIDTH / 2,
            backgroundColor: row.nodeColor,
            width: LINE_WIDTH,
          }}
        />
      )}

      {/* Node column: below rail (dot to bottom) */}
      {row.hasLineBelow && (
        <div
          className="commit-graph-rail commit-graph-rail-below"
          style={{
            left: nodeX - LINE_WIDTH / 2,
            backgroundColor: row.nodeColor,
            width: LINE_WIDTH,
          }}
        />
      )}

      {/* Commit dot — pinned at NODE_Y */}
      <div
        className="commit-graph-node"
        style={{
          left: nodeX - NODE_SIZE / 2,
          top: NODE_Y - NODE_SIZE / 2,
          width: NODE_SIZE,
          height: NODE_SIZE,
          backgroundColor: row.nodeColor,
        }}
      />

      {/* SVG for incoming merge curves (fixed height: 0 to NODE_Y) */}
      {hasIncoming && (
        <svg
          className="commit-graph-curves-incoming"
          style={{ width }}
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
        >
          {row.incomingMerges.map((m) => (
            <path
              key={`in-${m.fromCol}`}
              d={curvePath(colX(m.fromCol), 0, nodeX, 100)}
              stroke={m.color}
              strokeWidth={LINE_WIDTH}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}

      {/* SVG for outgoing branch curves (stretches: NODE_Y to bottom) */}
      {hasOutgoing && (
        <svg
          className="commit-graph-curves-outgoing"
          style={{ width }}
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
        >
          {row.outgoingBranches.map((b) => (
            <path
              key={`out-${b.toCol}`}
              d={curvePath(nodeX, 0, colX(b.toCol), 100)}
              stroke={b.color}
              strokeWidth={LINE_WIDTH}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
