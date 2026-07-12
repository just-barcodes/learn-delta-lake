import { describe, expect, it } from "vitest";
import { initialState } from "./initialState";
import * as ops from "./operations";
import { liveFileIds, liveRecords, liveRowCount, protocolAt, schemaIdAt } from "./replay";
import { fieldInSchema, SCHEMA_DEFS } from "./schemas";
import type { TableState } from "./types";

/** Select the given order ids in the picker, mapped to the file that holds each. */
function pick(s: TableState, ids: number[]): TableState {
  let next = ops.openDelete(s);
  for (const id of ids) {
    const file = Object.values(next.dataFiles).find((f) =>
      f.records.some((r) => r.order_id === id),
    );
    next = ops.togglePick(next, id, file!.id);
  }
  return next;
}

describe("append", () => {
  it("adds a version, new data files, and grows the live-row count", () => {
    const s = ops.append({ ...initialState(), appendRows: 6 });
    expect(s.current).toBe(1);
    expect(s.commits).toHaveLength(2);
    expect(liveRowCount(s, 1)).toBe(12);
    expect(liveFileIds(s, 1).size).toBe(3); // d1, d2 + 1 new file
  });

  it("only adds `add` actions and leaves earlier versions intact", () => {
    const s = ops.append(initialState());
    const kinds = s.commits[1].actions.map((a) => a.kind);
    expect(kinds.filter((k) => k === "add").length).toBeGreaterThanOrEqual(1);
    expect(kinds).not.toContain("remove");
    expect(liveRowCount(s, 0)).toBe(6); // version 0 unchanged
  });
});

describe("copy-on-write delete (default mode)", () => {
  it("removes the old file and adds a rewritten one, dropping the row", () => {
    const s = ops.confirmDelete(pick(initialState(), [1001]));
    expect(s.current).toBe(1);
    expect(liveRowCount(s, 1)).toBe(5);
    const kinds = s.commits[1].actions.map((a) => a.kind);
    expect(kinds).toContain("remove");
    expect(kinds).toContain("add");
    expect(Object.keys(s.deletionVectors)).toHaveLength(0);
    // d1 tombstoned, still on disk (not yet vacuumed) but not live
    expect(liveFileIds(s, 1).has("d1")).toBe(false);
    expect(s.dataFiles.d1).toBeDefined();
  });

  it("removes a file with no survivors without adding a replacement", () => {
    // d1 holds orders 1001,1002,1003 — delete all three
    const s = ops.confirmDelete(pick(initialState(), [1001, 1002, 1003]));
    expect(liveRowCount(s, 1)).toBe(3);
    const adds = s.commits[1].actions.filter((a) => a.kind === "add");
    expect(adds).toHaveLength(0); // nothing survived in d1
  });
});

describe("deletion-vector delete (advanced mode)", () => {
  it("writes a DV, keeps the data file, and upgrades the protocol", () => {
    const base = ops.setDeleteMode(initialState(), "dv");
    const s = ops.confirmDelete(pick(base, [1001]));
    expect(s.current).toBe(1);
    expect(liveRowCount(s, 1)).toBe(5);
    expect(Object.keys(s.deletionVectors)).toHaveLength(1);
    // data file d1 is still live (masked, not rewritten)
    expect(liveFileIds(s, 1).has("d1")).toBe(true);
    expect(protocolAt(s, 1)?.features).toContain("deletionVectors");
  });

  it("unions a second DV delete on the same file", () => {
    const base = ops.setDeleteMode(initialState(), "dv");
    const s1 = ops.confirmDelete(pick(base, [1001]));
    const s2 = ops.confirmDelete(pick(s1, [1002]));
    expect(liveRowCount(s2, 2)).toBe(4);
    const dv = Object.values(s2.deletionVectors).find((d) => d.born === 2)!;
    expect(dv.deletedIds).toEqual([1001, 1002]);
  });
});

/** Open the UPDATE picker and check the given ids. */
function pickUpdate(s: TableState, ids: number[]): TableState {
  let next = ops.openUpdate(s);
  for (const id of ids) {
    const file = Object.values(next.dataFiles).find((f) =>
      f.records.some((r) => r.order_id === id),
    );
    next = ops.togglePick(next, id, file!.id);
  }
  return next;
}

describe("update", () => {
  it("copy-on-write UPDATE rewrites files and changes values without losing rows", () => {
    const s = ops.confirmUpdate(pickUpdate(initialState(), [1001]));
    expect(s.current).toBe(1);
    expect(liveRowCount(s, 1)).toBe(6); // row count preserved (unlike delete)
    const kinds = s.commits[1].actions.map((a) => a.kind);
    expect(kinds).toContain("remove");
    expect(kinds).toContain("add");
    expect(Object.keys(s.deletionVectors)).toHaveLength(0);
    expect(liveRecords(s, 1).live.find((r) => r.order_id === 1001)?.status).toBe("refunded");
    expect(liveFileIds(s, 1).has("d1")).toBe(false); // original rewritten
  });

  it("deletion-vector UPDATE masks the old row, adds a new file, and upgrades the protocol", () => {
    const base = ops.setDeleteMode(initialState(), "dv");
    const s = ops.confirmUpdate(pickUpdate(base, [1001]));
    expect(liveRowCount(s, 1)).toBe(6);
    expect(Object.keys(s.deletionVectors)).toHaveLength(1);
    expect(protocolAt(s, 1)?.features).toContain("deletionVectors");
    expect(liveFileIds(s, 1).has("d1")).toBe(true); // old file kept, masked
    expect(liveRecords(s, 1).live.find((r) => r.order_id === 1001)?.status).toBe("refunded");
  });
});

describe("optimize", () => {
  it("bin-packs live files within each partition and never mixes partitions", () => {
    // initial d1,d2 are in partition 2026-01; the append lands d3 in 2026-02
    const appended = ops.append({ ...initialState(), appendRows: 6 });
    const s = ops.optimize(appended);
    expect(s.current).toBe(2);
    // 2026-01 (d1+d2) compacts to one file; 2026-02 (single d3) is left untouched
    expect(liveFileIds(s, 2).size).toBe(2);
    expect(liveRowCount(s, 2)).toBe(liveRowCount(appended, 1));
    // every live file still belongs to exactly one partition — no cross-partition merge
    const parts = new Set([...liveFileIds(s, 2)].map((id) => s.dataFiles[id].partition));
    expect(parts).toEqual(new Set(["2026-01", "2026-02"]));
    const info = s.commits[2].actions.find((a) => a.kind === "commitInfo");
    expect(info).toBeTruthy();
    // dataChange:false — logical table unchanged
    expect(s.commits[2].actions.every((a) => a.kind !== "add" || a.dataChange === false)).toBe(
      true,
    );
  });

  it("refuses when there is nothing worth optimizing", () => {
    // initial has 2 files; delete-all-but leaves 1... instead test a single-file table
    const s = ops.optimize(initialState()); // 2 files → will optimize
    expect(s.current).toBe(1);
    const again = ops.optimize(s); // now 1 file, no DV → refuse
    expect(again.current).toBe(1);
    expect(again.lastStep.title).toMatch(/nothing worth optimizing/i);
  });
});

describe("vacuum", () => {
  it("deletes tombstoned files without adding a version", () => {
    const deleted = ops.confirmDelete(pick(initialState(), [1001])); // tombstones d1
    expect(deleted.dataFiles.d1).toBeDefined();
    const s = ops.vacuum(deleted);
    expect(s.current).toBe(deleted.current); // no new version
    expect(s.commits).toHaveLength(deleted.commits.length);
    expect(s.dataFiles.d1).toBeUndefined(); // physically gone
    expect(liveRowCount(s, s.current)).toBe(5); // current version still intact
  });

  it("refuses when nothing is tombstoned", () => {
    const s = ops.vacuum(initialState());
    expect(s.lastStep.title).toMatch(/nothing to vacuum/i);
    expect(s.dataFiles.d1).toBeDefined();
  });
});

describe("checkpoint", () => {
  it("snapshots live files without adding a version", () => {
    const appended = ops.append(initialState());
    const s = ops.checkpoint(appended);
    expect(s.current).toBe(appended.current);
    expect(s.commits).toHaveLength(appended.commits.length);
    expect(s.checkpoints).toHaveLength(1);
    expect(s.checkpoints[0].version).toBe(appended.current);
    expect(s.checkpoints[0].liveFiles.map((f) => f.path).sort()).toEqual(
      [...liveFileIds(appended, appended.current)].sort(),
    );
  });

  it("refuses a duplicate checkpoint at the same version", () => {
    const s = ops.checkpoint(ops.checkpoint(ops.append(initialState())));
    expect(s.checkpoints).toHaveLength(1);
    expect(s.lastStep.title).toMatch(/already exists/i);
  });
});

describe("schema evolution", () => {
  it("commits a new version with an updated metaData; ADD COLUMN needs no protocol change", () => {
    const s = ops.evolveSchema(initialState());
    expect(s.current).toBe(1); // schema change IS a commit in Delta (unlike Iceberg)
    expect(s.schemaId).toBe(1);
    expect(s.commits[1].actions.some((a) => a.kind === "metaData")).toBe(true);
    expect(s.commits[1].actions.some((a) => a.kind === "protocol")).toBe(false);
    // region (id 6) exists from schema 1 on, not before
    expect(fieldInSchema(6, 0)).toBe(false);
    expect(fieldInSchema(6, 1)).toBe(true);
    expect(schemaIdAt(s, 1)).toBe(1);
  });

  it("renaming a column upgrades the protocol with column mapping", () => {
    const s = ops.evolveSchema(ops.evolveSchema(initialState())); // add region, then rename
    expect(s.schemaId).toBe(2);
    expect(protocolAt(s, s.current)?.features).toContain("columnMapping");
  });

  it("widening a type adds the type-widening feature", () => {
    let s = initialState();
    for (let i = 0; i < 4; i++) s = ops.evolveSchema(s); // through the widen change
    expect(s.schemaId).toBe(4);
    expect(protocolAt(s, s.current)?.features).toContain("typeWidening");
  });

  it("tags newly-appended files with the current schema; old files keep theirs", () => {
    const s = ops.append(ops.evolveSchema(initialState()));
    const fresh = Object.values(s.dataFiles).find((f) => f.born === s.current)!;
    expect(fresh.schemaId).toBe(1);
    expect(s.dataFiles.d1.schemaId).toBe(0); // original file unchanged
  });

  it("refuses past the last schema version", () => {
    let s = initialState();
    for (let i = 0; i < SCHEMA_DEFS.length - 1; i++) s = ops.evolveSchema(s);
    const again = ops.evolveSchema(s);
    expect(again.current).toBe(s.current); // no new version
    expect(again.lastStep.title).toMatch(/latest schema/i);
  });
});

describe("reset", () => {
  it("returns to the initial table but keeps level and delete mode", () => {
    const dirty = ops.append(ops.setDeleteMode({ ...initialState(), level: "advanced" }, "dv"));
    const s = ops.reset(dirty);
    expect(s.current).toBe(0);
    expect(s.level).toBe("advanced");
    expect(s.deleteMode).toBe("dv");
  });
});
