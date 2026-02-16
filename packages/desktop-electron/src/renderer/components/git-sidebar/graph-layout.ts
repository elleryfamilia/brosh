/**
 * Git Graph Layout Algorithm
 *
 * Computes column assignments for a visual commit graph.
 * Processes commits in topo order, assigning each to a column
 * and routing parent connections as rails or curves.
 */

import type { GitCommit } from "../smart-status-bar/types";

// Dimensional constants
export const COL_SPACING = 16;
export const NODE_SIZE = 10;
export const LINE_WIDTH = 2;
export const LEFT_PAD = 12;
export const NODE_Y = 24; // fixed vertical center of commit header (48px height)

// 10-color palette for branch columns
export const GRAPH_COLORS = [
  "#5ec4b6", // teal
  "#e8837c", // salmon
  "#6ea8fe", // blue
  "#b38bfa", // purple
  "#f0c75e", // yellow
  "#7ec8e3", // light-blue
  "#e06c75", // red
  "#72c285", // green
  "#d4a843", // gold
  "#7fd5b9", // mint
];

export interface MergeCurve {
  fromCol: number;
  color: string;
}

export interface BranchCurve {
  toCol: number;
  color: string;
}

export interface PassThrough {
  col: number;
  color: string;
}

export interface GraphRow {
  nodeCol: number;
  nodeColor: string;
  hasLineAbove: boolean;
  hasLineBelow: boolean;
  passThroughs: PassThrough[];
  incomingMerges: MergeCurve[];
  outgoingBranches: BranchCurve[];
  maxColumns: number;
}

/**
 * Compute graph layout for a list of commits in topo order.
 * Returns one GraphRow per commit describing how to render its graph cell.
 */
export function computeGraphLayout(commits: GitCommit[]): GraphRow[] {
  if (commits.length === 0) return [];

  // columns[i] = hash of the commit expected next at column i, or null if free
  const columns: (string | null)[] = [];
  // Track which color each column uses
  const colColors: string[] = [];
  let nextColorIdx = 0;

  const rows: GraphRow[] = [];

  const allocColor = (): string => {
    const color = GRAPH_COLORS[nextColorIdx % GRAPH_COLORS.length];
    nextColorIdx++;
    return color;
  };

  const findFreeCol = (): number => {
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] === null) return i;
    }
    return columns.length;
  };

  const ensureCol = (idx: number) => {
    while (columns.length <= idx) {
      columns.push(null);
      colColors.push("");
    }
  };

  for (const commit of commits) {
    // Find all columns expecting this commit
    const expectingCols: number[] = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] === commit.hash) {
        expectingCols.push(i);
      }
    }

    let nodeCol: number;
    let nodeColor: string;
    let hasLineAbove: boolean;
    const incomingMerges: MergeCurve[] = [];

    if (expectingCols.length === 0) {
      // Branch head — not expected by any child, allocate new column
      nodeCol = findFreeCol();
      ensureCol(nodeCol);
      nodeColor = allocColor();
      colColors[nodeCol] = nodeColor;
      hasLineAbove = false;
    } else {
      // Place at leftmost expecting column
      nodeCol = expectingCols[0];
      nodeColor = colColors[nodeCol];
      hasLineAbove = true;

      // Extra expecting columns = convergent merge (multiple children)
      for (let i = 1; i < expectingCols.length; i++) {
        const col = expectingCols[i];
        incomingMerges.push({ fromCol: col, color: colColors[col] });
        // Free the extra column
        columns[col] = null;
      }
    }

    // Route parents
    const outgoingBranches: BranchCurve[] = [];
    const newBranchCols = new Set<number>();
    const hasLineBelow = commit.parents.length > 0;

    if (commit.parents.length === 0) {
      // Root commit — free the column
      columns[nodeCol] = null;
    } else {
      // First parent inherits column
      columns[nodeCol] = commit.parents[0];

      // Additional parents — find existing column or allocate new
      for (let p = 1; p < commit.parents.length; p++) {
        const parentHash = commit.parents[p];

        // Check if any column already expects this parent
        let existingCol = -1;
        for (let i = 0; i < columns.length; i++) {
          if (columns[i] === parentHash) {
            existingCol = i;
            break;
          }
        }

        if (existingCol >= 0) {
          // Parent already has a column — draw curve to it
          outgoingBranches.push({ toCol: existingCol, color: colColors[existingCol] });
        } else {
          // Allocate new column for this parent
          const newCol = findFreeCol();
          ensureCol(newCol);
          const color = allocColor();
          colColors[newCol] = color;
          columns[newCol] = parentHash;
          outgoingBranches.push({ toCol: newCol, color });
          newBranchCols.add(newCol);
        }
      }
    }

    // Compute pass-throughs: active columns that aren't this node's column,
    // weren't just freed (incoming merges), and weren't just allocated (outgoing branches).
    // Newly-allocated columns only have the outgoing curve — no rail from above.
    const freedCols = new Set(incomingMerges.map((m) => m.fromCol));
    const passThroughs: PassThrough[] = [];
    for (let i = 0; i < columns.length; i++) {
      if (i === nodeCol) continue;
      if (freedCols.has(i)) continue;
      if (newBranchCols.has(i)) continue;
      if (columns[i] !== null) {
        passThroughs.push({ col: i, color: colColors[i] });
      }
    }

    // Determine max active columns for width calculation
    let maxCol = nodeCol;
    for (const pt of passThroughs) {
      if (pt.col > maxCol) maxCol = pt.col;
    }
    for (const m of incomingMerges) {
      if (m.fromCol > maxCol) maxCol = m.fromCol;
    }
    for (const b of outgoingBranches) {
      if (b.toCol > maxCol) maxCol = b.toCol;
    }

    rows.push({
      nodeCol,
      nodeColor,
      hasLineAbove,
      hasLineBelow,
      passThroughs,
      incomingMerges,
      outgoingBranches,
      maxColumns: maxCol + 1,
    });
  }

  // Normalize maxColumns to global max across all rows
  let globalMax = 0;
  for (const row of rows) {
    if (row.maxColumns > globalMax) globalMax = row.maxColumns;
  }
  for (const row of rows) {
    row.maxColumns = globalMax;
  }

  return rows;
}
