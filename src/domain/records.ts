import type { OrderRecord } from "./types";

const CUSTOMERS = [
  "Stark Industries",
  "Oscorp",
  "Roxxon Energy",
  "Pym Technologies",
  "Alchemax",
  "Hammer Ind.",
  "Rand Enterprises",
  "Baxter Foundation",
];

const STATUSES = ["paid", "pending", "shipped", "refunded"];

const REGIONS = ["EMEA", "AMER", "APAC"];

/** A mutable order-id counter threaded through record generation. */
export interface OrderIdCounter {
  oid: number;
}

export interface GenOptions {
  /** The order_month partition value, e.g. "2026-01". */
  month: string;
}

/**
 * Deterministically generate `n` order records. Values are derived purely from the
 * order id, so the table is reproducible. Mutates `ctr.oid`.
 */
export function genRecords(n: number, opts: GenOptions, ctr: OrderIdCounter): OrderRecord[] {
  const out: OrderRecord[] = [];
  for (let made = 0; made < n; made++) {
    ctr.oid++;
    const id = ctr.oid;
    const day = 1 + (id % 27);
    out.push({
      order_id: id,
      customer: CUSTOMERS[id % CUSTOMERS.length],
      amount: "CHF " + (((id * 37) % 900) + 60) + "." + String((id * 7) % 100).padStart(2, "0"),
      order_date: opts.month + "-" + String(day).padStart(2, "0"),
      status: STATUSES[id % STATUSES.length],
      region: REGIONS[id % REGIONS.length],
    });
  }
  return out;
}
