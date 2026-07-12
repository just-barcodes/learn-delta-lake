import { describe, expect, it } from "vitest";
import { genRecords, type OrderIdCounter } from "./records";

describe("genRecords", () => {
  it("is deterministic: values derive purely from the order id", () => {
    const a = genRecords(3, { month: "2026-01" }, { oid: 1000 });
    const b = genRecords(3, { month: "2026-01" }, { oid: 1000 });
    expect(a).toEqual(b);
  });

  it("advances the shared counter across calls so ids never collide", () => {
    const ctr: OrderIdCounter = { oid: 1000 };
    const first = genRecords(3, { month: "2026-01" }, ctr);
    const second = genRecords(3, { month: "2026-01" }, ctr);
    expect(first.map((r) => r.order_id)).toEqual([1001, 1002, 1003]);
    expect(second.map((r) => r.order_id)).toEqual([1004, 1005, 1006]);
    expect(ctr.oid).toBe(1006);
  });

  it("formats amount, date, customer and status from the id", () => {
    const [r] = genRecords(1, { month: "2026-01" }, { oid: 1000 });
    expect(r).toEqual({
      order_id: 1001,
      customer: "Oscorp",
      amount: "CHF 197.07",
      order_date: "2026-01-03",
      status: "pending",
      region: "APAC",
    });
  });

  it("stamps every row with the requested month partition", () => {
    const rows = genRecords(4, { month: "2026-03" }, { oid: 2000 });
    expect(rows.every((r) => r.order_date.startsWith("2026-03-"))).toBe(true);
  });
});
