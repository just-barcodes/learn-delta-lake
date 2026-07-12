import { describe, expect, it } from "vitest";
import { initialState } from "./initialState";
import { GEN_MONTH } from "./schema";

describe("initialState", () => {
  it("starts at version 0, viewing current", () => {
    const s = initialState();
    expect(s.current).toBe(0);
    expect(s.selected).toBe(0);
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0].version).toBe(0);
  });

  it("commit 0 holds protocol, metaData, and two add actions", () => {
    const s = initialState();
    const kinds = s.commits[0].actions.map((a) => a.kind);
    expect(kinds).toContain("protocol");
    expect(kinds).toContain("metaData");
    expect(kinds.filter((k) => k === "add")).toHaveLength(2);
  });

  it("holds two data files of three rows each in the 2026-01 partition", () => {
    const s = initialState();
    expect(Object.keys(s.dataFiles)).toEqual(["d1", "d2"]);
    expect(s.dataFiles.d1.records).toHaveLength(3);
    expect(s.dataFiles.d2.records).toHaveLength(3);
    expect(s.dataFiles.d1.partition).toBe("2026-01");
  });

  it("records every partition column in the table schema (Delta has no hidden transforms)", () => {
    const s = initialState();
    const meta = s.commits[0].actions.find((a) => a.kind === "metaData")!;
    if (meta.kind !== "metaData") throw new Error("expected metaData action");
    // A Delta partition column must be a real column of the schema.
    for (const col of meta.partitionBy) expect(meta.schema).toContain(col);
    // order_month is modelled as a generated column derived from order_date.
    expect(GEN_MONTH.name).toBe("order_month");
    expect(GEN_MONTH.generated).toContain("order_date");
  });

  it("has no deletion vectors, no checkpoints, and copy-on-write deletes", () => {
    const s = initialState();
    expect(s.deletionVectors).toEqual({});
    expect(s.checkpoints).toEqual([]);
    expect(s.deleteMode).toBe("cow");
    expect(s.counters.oid).toBe(1006);
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = initialState();
    const b = initialState();
    a.dataFiles.d1.records.push({
      order_id: 9,
      customer: "x",
      amount: "CHF 1.00",
      order_date: "2026-01-01",
      status: "paid",
      region: "EMEA",
    });
    expect(b.dataFiles.d1.records).toHaveLength(3);
  });
});
