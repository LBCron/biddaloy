/**
 * [8.15.27] Rows to a matrix, as a pure function: the "table of counts" (glossary) behind
 * `ReportCrosstab`. No React, no formatting; the renderer turns the raw parts into words.
 *
 * ```
 * rows: { class: 'Six', gender: 'Boy', religion: 'Islam', students: 40 } ...
 * pivot(rows, { rows: ['class'], columns: ['gender', 'religion'], measure: 'students', type: 'NUMBER' })
 *   rowKeys   Six, Seven ...
 *   colKeys   Boy > Islam, Hindu  |  Girl > Islam, Hindu     (a tree; `leaves` is the flat list)
 *   cells     cells[rowId][leafId]
 *   rowTotals / colTotals / grand
 * ```
 *
 * Order is the order values first appear: the server already sorted. Totals are added from every
 * raw row, not from the cells, so a row total never depends on how the cells are drawn. A hidden
 * (`null`) value cannot be added: it makes every total it belongs to `incomplete`, and the renderer
 * shows those as hidden instead of as a number that is too small.
 */
import { addUp, type AddedUp } from './format-cell';
import type { ReportColumnType, ReportRow } from './types';

export interface PivotInput {
  /** Fields that name a row, outermost first. Empty: one row. */
  rows: readonly string[];
  /** Fields that name a column, outermost first. Empty: one column. */
  columns: readonly string[];
  /** The field added up in each cell. */
  measure: string;
  /** Its type: only NUMBER and MONEY have totals. */
  type: ReportColumnType;
}

export interface PivotKey {
  id: string;
  /** Raw values, one per field. */
  parts: unknown[];
}

/** One header cell in the (nested) column header. */
export interface PivotColNode {
  id: string;
  value: unknown;
  /** 0 is the outermost header row. */
  depth: number;
  /** How many leaf columns sit under it. */
  span: number;
  children: PivotColNode[];
}

export interface PivotResult {
  rowKeys: PivotKey[];
  /** Top level of the nested column header; empty when there are no column fields. */
  colKeys: PivotColNode[];
  /** Every leaf column, left to right. */
  leaves: PivotKey[];
  /** `cells[rowId][leafId]`; a row/column pair with no result row is absent (a count of nothing). */
  cells: Record<string, Record<string, AddedUp>>;
  rowTotals: Record<string, AddedUp>;
  colTotals: Record<string, AddedUp>;
  grand: AddedUp;
}

const idOf = (parts: readonly unknown[]) => JSON.stringify(parts.map((v) => v ?? null));
const partsOf = (row: ReportRow, fields: readonly string[]) => fields.map((f) => row[f] ?? null);

export function pivot(rows: readonly ReportRow[], input: PivotInput): PivotResult {
  const rowKeys = new Map<string, PivotKey>();
  const leaves = new Map<string, PivotKey>();
  const roots: PivotColNode[] = [];
  const nodes = new Map<string, PivotColNode>();

  const cellValues = new Map<string, Map<string, unknown[]>>();
  const rowValues = new Map<string, unknown[]>();
  const colValues = new Map<string, unknown[]>();
  const all: unknown[] = [];

  for (const row of rows) {
    const rowParts = partsOf(row, input.rows);
    const colParts = partsOf(row, input.columns);
    const rowId = idOf(rowParts);
    const leafId = idOf(colParts);
    const value = row[input.measure] ?? null;

    if (!rowKeys.has(rowId)) rowKeys.set(rowId, { id: rowId, parts: rowParts });
    if (!leaves.has(leafId)) {
      leaves.set(leafId, { id: leafId, parts: colParts });
      // Walk down the header tree, creating a node per level the first time it is seen.
      let siblings = roots;
      colParts.forEach((part, depth) => {
        const id = idOf(colParts.slice(0, depth + 1));
        let node = nodes.get(id);
        if (!node) {
          node = { id, value: part, depth, span: 0, children: [] };
          nodes.set(id, node);
          siblings.push(node);
        }
        node.span += 1;
        siblings = node.children;
      });
    }

    const byLeaf = cellValues.get(rowId) ?? new Map<string, unknown[]>();
    cellValues.set(rowId, byLeaf);
    byLeaf.set(leafId, [...(byLeaf.get(leafId) ?? []), value]);
    rowValues.set(rowId, [...(rowValues.get(rowId) ?? []), value]);
    colValues.set(leafId, [...(colValues.get(leafId) ?? []), value]);
    all.push(value);
  }

  const total = (values: unknown[]) => addUp(values, input.type);
  const cells: PivotResult['cells'] = {};
  for (const [rowId, byLeaf] of cellValues) {
    cells[rowId] = {};
    for (const [leafId, values] of byLeaf) cells[rowId][leafId] = total(values);
  }

  return {
    rowKeys: [...rowKeys.values()],
    colKeys: roots,
    leaves: [...leaves.values()],
    cells,
    rowTotals: Object.fromEntries([...rowValues].map(([id, v]) => [id, total(v)])),
    colTotals: Object.fromEntries([...colValues].map(([id, v]) => [id, total(v)])),
    grand: total(all),
  };
}
