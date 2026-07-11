import { describe, expect, it } from "vitest";
import {
  deletedIdsAt,
  liveFileIds,
  liveRowCount,
  metadataAt,
  protocolAt,
  replayPath,
} from "./replay";
import { computeStats } from "./stats";
import type { Action, Commit, DataFile, TableState } from "./types";

/** Minimal data file with N rows starting at a given order id, for replay tests. */
function file(id: string, startId: number, n: number, born: number, dv?: string): DataFile {
  const records = Array.from({ length: n }, (_, i) => ({
    order_id: startId + i,
    customer: "c",
    amount: "CHF 100.00",
    order_date: "2026-01-05",
    status: "paid",
  }));
  return {
    id,
    records,
    size: n,
    partition: "2026-01",
    born,
    stats: computeStats(records),
    dv: dv ?? null,
  };
}

function commit(version: number, op: Commit["op"], actions: Action[]): Commit {
  return { version, op, ts: "10:00", actions };
}

/**
 * A scripted log: v0 create (d1,d2); v1 append (d3); v2 COW delete (remove d1, add d1b);
 * v3 DV delete on d3 (remove d3, re-add d3 with dv1 masking order 2001).
 */
function scriptedState(): TableState {
  return {
    commits: [
      commit(0, "append", [
        { kind: "protocol", minReader: 1, minWriter: 2, features: [] },
        { kind: "metaData", schema: ["order_id"], partitionBy: ["order_month"] },
        { kind: "add", path: "d1", dataChange: true },
        { kind: "add", path: "d2", dataChange: true },
      ]),
      commit(1, "append", [{ kind: "add", path: "d3", dataChange: true }]),
      commit(2, "delete", [
        { kind: "remove", path: "d1", dataChange: true },
        { kind: "add", path: "d1b", dataChange: true },
      ]),
      commit(3, "delete", [
        { kind: "remove", path: "d3", dataChange: true },
        { kind: "add", path: "d3", dataChange: false, dv: "dv1" },
      ]),
    ],
    checkpoints: [],
    dataFiles: {
      d1: file("d1", 1001, 2, 0),
      d2: file("d2", 1003, 2, 0),
      d3: file("d3", 2001, 2, 1),
      d1b: file("d1b", 1002, 1, 2),
    },
    deletionVectors: {
      dv1: { id: "dv1", target: "d3", deletedIds: [2001], size: 1, born: 3 },
    },
    current: 3,
    selected: 3,
    deleteMode: "cow",
    inspect: null,
    picker: null,
    appendRows: 6,
    q: { col: "amount", op: ">=", val: "" },
    qActive: false,
    level: "medium",
    counters: { d: 4, x: 1, oid: 3000 },
    log: [],
    lastStep: { op: "append", title: "", body: "", bullets: [] },
  };
}

describe("liveFileIds — replay of add − remove", () => {
  it("reflects only the files present at each version", () => {
    const s = scriptedState();
    expect([...liveFileIds(s, 0)].sort()).toEqual(["d1", "d2"]);
    expect([...liveFileIds(s, 1)].sort()).toEqual(["d1", "d2", "d3"]);
    expect([...liveFileIds(s, 2)].sort()).toEqual(["d1b", "d2", "d3"]);
    expect([...liveFileIds(s, 3)].sort()).toEqual(["d1b", "d2", "d3"]);
  });

  it("does not let a later commit affect an earlier version (time travel is stable)", () => {
    const s = scriptedState();
    expect(liveFileIds(s, 0).has("d1")).toBe(true);
    expect(liveFileIds(s, 2).has("d1")).toBe(false);
  });
});

describe("deletedIdsAt — deletion vectors on live files", () => {
  it("is empty before a DV delete and reflects the DV afterwards", () => {
    const s = scriptedState();
    expect(deletedIdsAt(s, 2).size).toBe(0);
    expect([...deletedIdsAt(s, 3)]).toEqual([2001]);
  });

  it("masks the row so live-row count drops", () => {
    const s = scriptedState();
    // v2: d1b(1) + d2(2) + d3(2) = 5 live rows
    expect(liveRowCount(s, 2)).toBe(5);
    // v3: order 2001 masked by dv1 → 4 live rows
    expect(liveRowCount(s, 3)).toBe(4);
  });
});

describe("replayPath — the reader shortcut", () => {
  it("replays from zero when there is no checkpoint", () => {
    const s = scriptedState();
    const path = replayPath(s, 3);
    expect(path.checkpoint).toBeNull();
    expect(path.commits).toEqual([0, 1, 2, 3]);
  });

  it("starts from the latest checkpoint ≤ version and only replays the tail", () => {
    const s = scriptedState();
    s.checkpoints = [
      {
        version: 2,
        liveFiles: [
          { path: "d1b", dv: null },
          { path: "d2", dv: null },
          { path: "d3", dv: null },
        ],
        size: 3,
      },
    ];
    const path = replayPath(s, 3);
    expect(path.checkpoint?.version).toBe(2);
    expect(path.commits).toEqual([3]);
    // Same live set whether or not the checkpoint short-circuits replay.
    expect([...liveFileIds(s, 3)].sort()).toEqual(["d1b", "d2", "d3"]);
  });
});

describe("metadataAt / protocolAt", () => {
  it("return the latest metaData / protocol in effect at a version", () => {
    const s = scriptedState();
    expect(metadataAt(s, 3)).toEqual({ schema: ["order_id"], partitionBy: ["order_month"] });
    expect(protocolAt(s, 3)).toEqual({ minReader: 1, minWriter: 2, features: [] });
  });
});
