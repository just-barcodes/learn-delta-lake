import { describe, expect, it } from "vitest";
import { initialState } from "./initialState";
import { amt, computeStats } from "./stats";

describe("amt", () => {
  it("strips currency formatting to a number", () => {
    expect(amt("CHF 197.07")).toBe(197.07);
    expect(amt("nonsense")).toBe(0);
  });
});

describe("computeStats", () => {
  it("records per-column min/max, row count, and null counts", () => {
    const records = [
      {
        order_id: 1001,
        customer: "a",
        amount: "CHF 197.07",
        order_date: "2026-01-03",
        status: "paid",
        region: "EMEA",
      },
      {
        order_id: 1003,
        customer: "b",
        amount: "CHF 271.21",
        order_date: "2026-01-05",
        status: "paid",
        region: "APAC",
      },
    ];
    expect(computeStats(records)).toEqual({
      numRecords: 2,
      min: { order_id: 1001, amount: 197.07, order_date: "2026-01-03" },
      max: { order_id: 1003, amount: 271.21, order_date: "2026-01-05" },
      nullCount: { order_id: 0, amount: 0, order_date: 0 },
    });
  });

  it("returns neutral stats for an empty file", () => {
    expect(computeStats([])).toEqual({
      numRecords: 0,
      min: { order_id: 0, amount: 0, order_date: "" },
      max: { order_id: 0, amount: 0, order_date: "" },
      nullCount: { order_id: 0, amount: 0, order_date: 0 },
    });
  });
});

describe("stored stats on the initial table", () => {
  it("are written onto each data file", () => {
    const s = initialState();
    expect(s.dataFiles.d1.stats.min.order_id).toBe(1001);
    expect(s.dataFiles.d1.stats.max.order_id).toBe(1003);
    expect(s.dataFiles.d2.stats.min.order_id).toBe(1004);
    expect(s.dataFiles.d2.stats.max.order_id).toBe(1006);
    expect(s.dataFiles.d1.stats.numRecords).toBe(3);
  });
});
