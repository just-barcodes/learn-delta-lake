import type { FileStats, OrderRecord } from "./types";

/** Parse a display amount like "CHF 197.07" into a number. */
export function amt(v: string): number {
  return parseFloat(String(v).replace(/[^\d.]/g, "")) || 0;
}

/**
 * Compute the per-column min/max/nullCount + row count for a data file's records.
 * In Delta this is written inline into the `add` action's `stats` field at write
 * time; here it is called when a DataFile is created so the planner can skip files
 * from stored stats without opening them.
 */
export function computeStats(records: OrderRecord[]): FileStats {
  if (records.length === 0) {
    return {
      numRecords: 0,
      min: { order_id: 0, amount: 0, order_date: "" },
      max: { order_id: 0, amount: 0, order_date: "" },
      nullCount: { order_id: 0, amount: 0, order_date: 0 },
    };
  }
  const ids = records.map((r) => r.order_id);
  const am = records.map((r) => amt(r.amount));
  const dt = records.map((r) => r.order_date);
  return {
    numRecords: records.length,
    min: {
      order_id: Math.min(...ids),
      amount: Math.min(...am),
      order_date: dt.reduce((a, b) => (a < b ? a : b), dt[0]),
    },
    max: {
      order_id: Math.max(...ids),
      amount: Math.max(...am),
      order_date: dt.reduce((a, b) => (a > b ? a : b), dt[0]),
    },
    nullCount: { order_id: 0, amount: 0, order_date: 0 },
  };
}
