import { describe, expect, it } from "vitest";
import { initialState } from "./initialState";
import { fileMatchesQuery, planQuery, prunedSet, rowMatches } from "./query";
import { amt } from "./stats";
import type { TableState } from "./types";

const withQuery = (q: TableState["q"]): TableState => ({ ...initialState(), qActive: true, q });

describe("amount parsing", () => {
  it("strips currency formatting", () => {
    expect(amt("CHF 197.07")).toBe(197.07);
    expect(amt("nonsense")).toBe(0);
  });
});

describe("file skipping from stored stats", () => {
  // Initial data files: d1 holds ids 1001-1003, d2 holds 1004-1006.
  it("skips a file whose id range cannot satisfy the predicate", () => {
    const s = withQuery({ col: "order_id", op: ">", val: "1003" });
    expect([...prunedSet(s)!]).toEqual(["d1"]);
  });

  it("keeps a file whose range overlaps the predicate", () => {
    const s = initialState();
    expect(fileMatchesQuery(s.dataFiles.d2, { col: "order_id", op: ">", val: "1003" })).toBe(true);
    expect(fileMatchesQuery(s.dataFiles.d1, { col: "order_id", op: ">", val: "1003" })).toBe(false);
  });

  it("returns null when no query is active", () => {
    expect(prunedSet(initialState())).toBeNull();
  });

  it("matches date columns by prefix", () => {
    const s = initialState();
    expect(fileMatchesQuery(s.dataFiles.d1, { col: "order_date", op: "=", val: "2026-01" })).toBe(
      true,
    );
    expect(fileMatchesQuery(s.dataFiles.d1, { col: "order_date", op: "=", val: "2026-09" })).toBe(
      false,
    );
  });
});

describe("query planning", () => {
  it("reports scanned/skipped files and matching live rows", () => {
    const s = withQuery({ col: "order_id", op: ">", val: "1003" });
    expect(planQuery(s)).toEqual({ scanned: 1, pruned: 1, total: 2, rows: 3 });
  });

  it("returns null when inactive", () => {
    expect(planQuery(initialState())).toBeNull();
  });
});

describe("row matching", () => {
  const r = {
    order_id: 1005,
    customer: "x",
    amount: "CHF 500.00",
    order_date: "2026-02-11",
    status: "paid",
  };
  it("compares numeric and date predicates", () => {
    expect(rowMatches(r, { col: "order_id", op: ">=", val: "1005" })).toBe(true);
    expect(rowMatches(r, { col: "amount", op: "<", val: "400" })).toBe(false);
    expect(rowMatches(r, { col: "order_date", op: "=", val: "2026-02" })).toBe(true);
  });
});
