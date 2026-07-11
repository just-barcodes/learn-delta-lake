import { deletedIdsAt, liveFileIds } from "./replay";
import { amt } from "./stats";
import type { DataFile, OrderRecord, Query, QueryOp, TableState } from "./types";

/** Whether a value under `op` could match anything in the [min, max] range. */
export function rangeOverlap(min: number, max: number, op: QueryOp, v: number): boolean {
  switch (op) {
    case "=":
      return v >= min && v <= max;
    case ">":
      return max > v;
    case ">=":
      return max >= v;
    case "<":
      return min < v;
    case "<=":
      return min <= v;
  }
  return true;
}

/**
 * Whether a data file's stored stats overlap the query, i.e. it cannot be skipped.
 * Reads the min/max recorded in the file's `add.stats` (as Delta's data skipping
 * does), never the row data itself.
 */
export function fileMatchesQuery(f: DataFile, q: Query): boolean {
  if (!q || q.val === "" || q.val == null) return true;
  const { min, max } = f.stats;
  if (q.col === "order_date") {
    const L = String(q.val).length;
    return min.order_date.slice(0, L) <= q.val && q.val <= max.order_date.slice(0, L);
  }
  const v = parseFloat(q.val);
  if (isNaN(v)) return true;
  if (q.col === "amount") return rangeOverlap(min.amount, max.amount, q.op, v);
  return rangeOverlap(min.order_id, max.order_id, q.op, v);
}

/** Whether an individual row satisfies the query predicate. */
export function rowMatches(r: OrderRecord, q: Query): boolean {
  if (q.col === "order_date") {
    return String(r.order_date).slice(0, String(q.val).length) === String(q.val);
  }
  const a = q.col === "amount" ? amt(r.amount) : r.order_id;
  const v = parseFloat(q.val);
  switch (q.op) {
    case "=":
      return a === v;
    case ">":
      return a > v;
    case ">=":
      return a >= v;
    case "<":
      return a < v;
    case "<=":
      return a <= v;
  }
  return true;
}

/** Live data files in the selected version that data skipping can skip, or null if no query. */
export function prunedSet(state: TableState): Set<string> | null {
  if (!state.qActive || !state.q || state.q.val === "" || state.q.val == null) return null;
  const out = new Set<string>();
  for (const id of liveFileIds(state, state.selected)) {
    const f = state.dataFiles[id];
    if (f && !fileMatchesQuery(f, state.q)) out.add(id);
  }
  return out;
}

export interface QueryResult {
  scanned: number;
  pruned: number;
  total: number;
  rows: number;
}

/** Run the query plan over the selected version: files scanned vs skipped, matching live rows. */
export function planQuery(state: TableState): QueryResult | null {
  const active = !!(state.qActive && state.q && state.q.val !== "" && state.q.val != null);
  if (!active) return null;
  const del = deletedIdsAt(state, state.selected);
  let scanned = 0;
  let pruned = 0;
  let rows = 0;
  for (const id of liveFileIds(state, state.selected)) {
    const f = state.dataFiles[id];
    if (!f) continue;
    if (fileMatchesQuery(f, state.q)) {
      scanned++;
      for (const r of f.records) {
        if (!del.has(r.order_id) && rowMatches(r, state.q)) rows++;
      }
    } else {
      pruned++;
    }
  }
  return { scanned, pruned, total: scanned + pruned, rows };
}
