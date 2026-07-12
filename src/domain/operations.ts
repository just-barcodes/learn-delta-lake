import { clock } from "./ids";
import { initialState } from "./initialState";
import { genRecords, type OrderIdCounter } from "./records";
import { liveFilesAt, liveRowCount, protocolAt } from "./replay";
import { DV_PROTOCOL, PARTITION_COLS, schemaColNames } from "./schema";
import { SCHEMA_DEFS } from "./schemas";
import { computeStats } from "./stats";
import type {
  Action,
  Checkpoint,
  Counters,
  DeleteMode,
  DetailLevel,
  LastStep,
  NodeKind,
  Operation,
  OrderRecord,
  QueryColumn,
  QueryOp,
  TableState,
} from "./types";

/** Coerce the (possibly-empty) append-rows field to a bounded row count. */
function appendCount(appendRows: number | ""): number {
  return Math.max(1, Math.min(999, parseInt(String(appendRows), 10) || 3));
}

/** Keep only the digits of raw input, or "" if none. */
function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Shared shape for an operation that appends one new version to the log. */
interface CommitResult {
  version: number;
  op: Operation;
  actions: Action[];
  counters: Counters;
  dataFiles?: TableState["dataFiles"];
  deletionVectors?: TableState["deletionVectors"];
  logText: string;
  lastStep: LastStep;
}

/** Append a new version to the log and move current/selected onto it. */
function commit(s: TableState, r: CommitResult): TableState {
  return {
    ...s,
    counters: r.counters,
    dataFiles: r.dataFiles ?? s.dataFiles,
    deletionVectors: r.deletionVectors ?? s.deletionVectors,
    commits: [
      ...s.commits,
      { version: r.version, op: r.op, ts: clock(r.version), actions: r.actions },
    ],
    current: r.version,
    selected: r.version,
    picker: null,
    log: [{ v: r.version, op: r.op, text: r.logText }, ...s.log],
    lastStep: r.lastStep,
  };
}

// ---- append -------------------------------------------------------------

export function append(s: TableState): TableState {
  const version = s.current + 1;
  const c = { ...s.counters };
  const month = "2026-0" + ((version % 3) + 1);
  const ctr: OrderIdCounter = { oid: c.oid };
  const rows = appendCount(s.appendRows);
  const nFiles = rows < 50 ? 1 : rows < 300 ? 2 : 3;
  const dataFiles = { ...s.dataFiles };
  const actions: Action[] = [];
  const nd: string[] = [];
  for (let i = 0; i < nFiles; i++) {
    const cnt = Math.floor(rows / nFiles) + (i < rows % nFiles ? 1 : 0);
    c.d++;
    const id = "d" + c.d;
    nd.push(id);
    const records = genRecords(cnt, { month }, ctr);
    dataFiles[id] = {
      id,
      records,
      size: Math.max(1, cnt),
      partition: month,
      born: version,
      schemaId: s.schemaId,
      stats: computeStats(records),
    };
    actions.push({ kind: "add", path: id, dataChange: true });
  }
  c.oid = ctr.oid;
  actions.push({
    kind: "commitInfo",
    operation: "WRITE",
    metrics: { numFiles: nFiles, numOutputRows: rows },
  });
  return commit(s, {
    version,
    op: "append",
    actions,
    counters: c,
    dataFiles,
    logText:
      "Appended " +
      rows +
      " rows across " +
      nFiles +
      " data file(s) (" +
      nd.join(", ") +
      ") → version " +
      version +
      ".",
    lastStep: {
      op: "append",
      title: "Append commit → version " + version,
      body: "INSERT writes new immutable Parquet files and appends one commit to the log listing an `add` action per file. The commit records only the delta; the reader replays it on top of the previous version.",
      bullets: [
        rows + " rows written to " + nFiles + " new data file(s): " + nd.join(", "),
        nFiles + " `add` action(s) in _delta_log/…" + String(version).padStart(4, "0") + ".json",
        "current version → " + version,
        "older files untouched and still referenced by earlier versions",
      ],
    },
  });
}

// ---- delete -------------------------------------------------------------

/** Open the delete picker, unless there are no live rows to delete. */
export function openDelete(s: TableState): TableState {
  if (!liveRowCount(s, s.current)) {
    return {
      ...s,
      lastStep: {
        op: "delete",
        title: "Nothing left to delete",
        body: "There are no live rows in the current version. Append some rows first.",
        bullets: [],
      },
    };
  }
  return { ...s, picker: { mode: "delete", selected: {}, n: 3 } };
}

/** Open the picker in UPDATE mode, unless there are no live rows to update. */
export function openUpdate(s: TableState): TableState {
  if (!liveRowCount(s, s.current)) {
    return {
      ...s,
      lastStep: {
        op: "update",
        title: "Nothing to update",
        body: "There are no live rows in the current version. Append some rows first.",
        bullets: [],
      },
    };
  }
  return { ...s, picker: { mode: "update", selected: {}, n: 3 } };
}

export function setRandomN(s: TableState, value: string): TableState {
  if (!s.picker) return s;
  const d = digits(value);
  return { ...s, picker: { ...s.picker, n: d === "" ? "" : parseInt(d, 10) } };
}

export function togglePick(s: TableState, oid: number, file: string): TableState {
  if (!s.picker) return s;
  const selected = { ...s.picker.selected };
  if (selected[oid]) delete selected[oid];
  else selected[oid] = file;
  return { ...s, picker: { ...s.picker, selected } };
}

export function cancelPicker(s: TableState): TableState {
  return { ...s, picker: null };
}

/** The live (oid, file) rows selectable in the picker at the current version. */
function liveRows(s: TableState): { oid: number; file: string }[] {
  const files = liveFilesAt(s, s.current);
  const rows: { oid: number; file: string }[] = [];
  for (const [path, dvId] of files) {
    const masked = dvId ? new Set(s.deletionVectors[dvId]?.deletedIds ?? []) : null;
    for (const r of s.dataFiles[path]?.records ?? []) {
      if (!(masked && masked.has(r.order_id))) rows.push({ oid: r.order_id, file: path });
    }
  }
  return rows;
}

/** Randomly check N of the live rows in the picker. Non-deterministic by design. */
export function randomPick(s: TableState): TableState {
  if (!s.picker) return s;
  const rows = liveRows(s);
  if (!rows.length) return s;
  const want = Math.max(1, Math.min(rows.length, parseInt(String(s.picker.n), 10) || 1));
  const shuffled = rows
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, want);
  const selected: Record<number, string> = {};
  shuffled.forEach((x) => {
    selected[x.oid] = x.file;
  });
  return { ...s, picker: { ...s.picker, selected } };
}

/** Commit the picked rows as a DELETE, using the active delete mode (copy-on-write or deletion vectors). */
export function confirmDelete(s: TableState): TableState {
  const sel = s.picker ? s.picker.selected : {};
  const entries = Object.keys(sel).map((k) => ({ order_id: Number(k), file: sel[Number(k)] }));
  if (!entries.length) return s;
  const byFile = new Map<string, Set<number>>();
  for (const e of entries) {
    const set = byFile.get(e.file) ?? new Set<number>();
    set.add(e.order_id);
    byFile.set(e.file, set);
  }
  const deletedIds = entries.map((e) => e.order_id).sort((a, b) => a - b);
  const targets = [...byFile.keys()].sort();
  return s.deleteMode === "cow"
    ? cowDelete(s, byFile, deletedIds, targets)
    : dvDelete(s, byFile, deletedIds, targets);
}

/** Copy-on-write: rewrite each affected file without the deleted (and already-masked) rows. */
function cowDelete(
  s: TableState,
  byFile: Map<string, Set<number>>,
  deletedIds: number[],
  targets: string[],
): TableState {
  const version = s.current + 1;
  const c = { ...s.counters };
  const dataFiles = { ...s.dataFiles };
  const liveMap = liveFilesAt(s, s.current);
  const actions: Action[] = [];
  const newIds: string[] = [];
  let copied = 0;
  for (const target of targets) {
    const orig = s.dataFiles[target];
    if (!orig) continue;
    const drop = byFile.get(target)!;
    const dvId = liveMap.get(target);
    const masked = dvId ? new Set(s.deletionVectors[dvId]?.deletedIds ?? []) : null;
    const survivors = orig.records.filter(
      (r) => !drop.has(r.order_id) && !(masked && masked.has(r.order_id)),
    );
    actions.push({ kind: "remove", path: target, dataChange: true });
    if (survivors.length) {
      c.d++;
      const id = "d" + c.d;
      newIds.push(id);
      copied += survivors.length;
      dataFiles[id] = {
        id,
        records: survivors,
        size: Math.max(1, survivors.length),
        partition: orig.partition,
        born: version,
        schemaId: s.schemaId,
        stats: computeStats(survivors),
      };
      actions.push({ kind: "add", path: id, dataChange: true });
    }
  }
  actions.push({
    kind: "commitInfo",
    operation: "DELETE",
    metrics: {
      numDeletedRows: deletedIds.length,
      numCopiedRows: copied,
      numRemovedFiles: targets.length,
      numAddedFiles: newIds.length,
    },
  });
  return commit(s, {
    version,
    op: "delete",
    actions,
    counters: c,
    dataFiles,
    logText:
      "Copy-on-write DELETE of " +
      deletedIds.length +
      " row(s) (" +
      deletedIds.join(", ") +
      ") → rewrote " +
      targets.length +
      " file(s), version " +
      version +
      ".",
    lastStep: {
      op: "delete",
      title: "Copy-on-write DELETE → version " + version,
      body: "Delta rewrites every file that holds a deleted row: the surviving rows are copied into brand-new files, the originals are tombstoned with `remove` actions. Simple for readers (no reconciliation), but it rewrites whole files to drop a few rows.",
      bullets: [
        "removed " + targets.length + " file(s): " + targets.join(", "),
        "added " + newIds.length + " rewritten file(s): " + (newIds.join(", ") || "none"),
        copied + " surviving row(s) copied; " + deletedIds.length + " dropped",
        "the old files persist on disk until VACUUM",
      ],
    },
  });
}

/** Deletion vectors: mask deleted row positions merge-on-read, leaving the data files in place. */
function dvDelete(
  s: TableState,
  byFile: Map<string, Set<number>>,
  deletedIds: number[],
  targets: string[],
): TableState {
  const version = s.current + 1;
  const c = { ...s.counters };
  const deletionVectors = { ...s.deletionVectors };
  const liveMap = liveFilesAt(s, s.current);
  const actions: Action[] = [];
  const proto = protocolAt(s, s.current);
  const upgraded = !proto?.features.includes("deletionVectors");
  if (upgraded) actions.push({ kind: "protocol", ...DV_PROTOCOL });
  const newDvIds: string[] = [];
  for (const target of targets) {
    const prevDvId = liveMap.get(target) ?? null;
    const prevIds = prevDvId ? (s.deletionVectors[prevDvId]?.deletedIds ?? []) : [];
    const union = [...new Set([...prevIds, ...byFile.get(target)!])].sort((a, b) => a - b);
    c.x++;
    const dvId = "x" + c.x;
    newDvIds.push(dvId);
    deletionVectors[dvId] = { id: dvId, target, deletedIds: union, size: 1, born: version };
    // Replace the file's add with one carrying the new deletion vector (same path).
    actions.push({ kind: "remove", path: target, dataChange: false });
    actions.push({ kind: "add", path: target, dataChange: false, dv: dvId });
  }
  actions.push({
    kind: "commitInfo",
    operation: "DELETE",
    metrics: { numDeletedRows: deletedIds.length, numDeletionVectorsAdded: newDvIds.length },
  });
  return commit(s, {
    version,
    op: "delete",
    actions,
    counters: c,
    deletionVectors,
    logText:
      "Deletion-vector DELETE of " +
      deletedIds.length +
      " row(s) (" +
      deletedIds.join(", ") +
      ") → " +
      newDvIds.length +
      " DV(s), version " +
      version +
      ".",
    lastStep: {
      op: "delete",
      title: "Deletion-vector DELETE → version " + version,
      body:
        "Delta does not rewrite the data files. It writes a small deletion vector marking which row positions are gone, and re-points the file's `add` at it. Readers subtract the DV on the fly: fast to commit, but adds a file to reconcile at read time." +
        (upgraded ? " Enabling DVs bumps the table protocol to reader 3 / writer 7." : ""),
      bullets: [
        newDvIds.length + " deletion vector(s) mask " + deletedIds.length + " row(s)",
        "targets " + targets.length + " data file(s): " + targets.join(", ") + " (left on disk)",
        upgraded
          ? "protocol upgraded → reader 3 / writer 7 (deletionVectors)"
          : "protocol already supports deletionVectors",
        "each affected file's `add` now references its DV",
      ],
    },
  });
}

// ---- update (the mechanism behind UPDATE / MERGE) ----------------------

/** UPDATE sets the picked rows' `status` to this value, to make the rewrite visible. */
const UPDATE_STATUS = "refunded";

/** Commit the picked rows as an UPDATE, using the active mode. Same file mechanics as DELETE, but rows change instead of vanishing. */
export function confirmUpdate(s: TableState): TableState {
  const sel = s.picker ? s.picker.selected : {};
  const entries = Object.keys(sel).map((k) => ({ order_id: Number(k), file: sel[Number(k)] }));
  if (!entries.length) return s;
  const byFile = new Map<string, Set<number>>();
  for (const e of entries) {
    const set = byFile.get(e.file) ?? new Set<number>();
    set.add(e.order_id);
    byFile.set(e.file, set);
  }
  const updatedIds = entries.map((e) => e.order_id).sort((a, b) => a - b);
  const targets = [...byFile.keys()].sort();
  return s.deleteMode === "cow"
    ? cowUpdate(s, byFile, updatedIds, targets)
    : dvUpdate(s, byFile, updatedIds, targets);
}

/** Copy-on-write UPDATE: rewrite each affected file, carrying the new values for the changed rows. */
function cowUpdate(
  s: TableState,
  byFile: Map<string, Set<number>>,
  updatedIds: number[],
  targets: string[],
): TableState {
  const version = s.current + 1;
  const c = { ...s.counters };
  const dataFiles = { ...s.dataFiles };
  const liveMap = liveFilesAt(s, s.current);
  const actions: Action[] = [];
  const newIds: string[] = [];
  let copied = 0;
  for (const target of targets) {
    const orig = s.dataFiles[target];
    if (!orig) continue;
    const change = byFile.get(target)!;
    const dvId = liveMap.get(target);
    const masked = dvId ? new Set(s.deletionVectors[dvId]?.deletedIds ?? []) : null;
    const survivors = orig.records.filter((r) => !(masked && masked.has(r.order_id)));
    const rewritten = survivors.map((r) =>
      change.has(r.order_id) ? { ...r, status: UPDATE_STATUS } : { ...r },
    );
    copied += survivors.length - change.size;
    actions.push({ kind: "remove", path: target, dataChange: true });
    c.d++;
    const id = "d" + c.d;
    newIds.push(id);
    dataFiles[id] = {
      id,
      records: rewritten,
      size: Math.max(1, rewritten.length),
      partition: orig.partition,
      born: version,
      schemaId: s.schemaId,
      stats: computeStats(rewritten),
    };
    actions.push({ kind: "add", path: id, dataChange: true });
  }
  actions.push({
    kind: "commitInfo",
    operation: "UPDATE",
    metrics: {
      numUpdatedRows: updatedIds.length,
      numCopiedRows: copied,
      numRemovedFiles: targets.length,
      numAddedFiles: newIds.length,
    },
  });
  return commit(s, {
    version,
    op: "update",
    actions,
    counters: c,
    dataFiles,
    logText:
      "Copy-on-write UPDATE of " +
      updatedIds.length +
      " row(s) (" +
      updatedIds.join(", ") +
      " → status=" +
      UPDATE_STATUS +
      ") → rewrote " +
      targets.length +
      " file(s), version " +
      version +
      ".",
    lastStep: {
      op: "update",
      title: "Copy-on-write UPDATE → version " + version,
      body: "UPDATE has no special action type: like DELETE, it rewrites every file holding a changed row. The surviving rows — changed and unchanged alike — are copied into new files (the changed ones carrying their new values), and the originals are tombstoned. This is the mechanism MERGE uses for its matched updates.",
      bullets: [
        "set status=" + UPDATE_STATUS + " on " + updatedIds.length + " row(s)",
        "removed " + targets.length + " file(s): " + targets.join(", "),
        "added " + newIds.length + " rewritten file(s): " + (newIds.join(", ") || "none"),
        copied + " unchanged row(s) copied alongside the changed ones",
      ],
    },
  });
}

/** Deletion-vector UPDATE: mask the old rows in place and add a small file with the new values (merge-on-read). */
function dvUpdate(
  s: TableState,
  byFile: Map<string, Set<number>>,
  updatedIds: number[],
  targets: string[],
): TableState {
  const version = s.current + 1;
  const c = { ...s.counters };
  const deletionVectors = { ...s.deletionVectors };
  const dataFiles = { ...s.dataFiles };
  const liveMap = liveFilesAt(s, s.current);
  const actions: Action[] = [];
  const proto = protocolAt(s, s.current);
  const upgraded = !proto?.features.includes("deletionVectors");
  if (upgraded) actions.push({ kind: "protocol", ...DV_PROTOCOL });
  const newDvIds: string[] = [];
  const newFileIds: string[] = [];
  for (const target of targets) {
    const change = byFile.get(target)!;
    const prevDvId = liveMap.get(target) ?? null;
    const prevIds = prevDvId ? (s.deletionVectors[prevDvId]?.deletedIds ?? []) : [];
    const union = [...new Set([...prevIds, ...change])].sort((a, b) => a - b);
    c.x++;
    const dvId = "x" + c.x;
    newDvIds.push(dvId);
    deletionVectors[dvId] = { id: dvId, target, deletedIds: union, size: 1, born: version };
    actions.push({ kind: "remove", path: target, dataChange: false });
    actions.push({ kind: "add", path: target, dataChange: false, dv: dvId });
    const orig = s.dataFiles[target];
    const updatedRows = (orig?.records ?? [])
      .filter((r) => change.has(r.order_id))
      .map((r) => ({ ...r, status: UPDATE_STATUS }));
    c.d++;
    const nid = "d" + c.d;
    newFileIds.push(nid);
    dataFiles[nid] = {
      id: nid,
      records: updatedRows,
      size: Math.max(1, updatedRows.length),
      partition: orig?.partition ?? "",
      born: version,
      schemaId: s.schemaId,
      stats: computeStats(updatedRows),
    };
    actions.push({ kind: "add", path: nid, dataChange: true });
  }
  actions.push({
    kind: "commitInfo",
    operation: "UPDATE",
    metrics: {
      numUpdatedRows: updatedIds.length,
      numDeletionVectorsAdded: newDvIds.length,
      numAddedFiles: newFileIds.length,
    },
  });
  return commit(s, {
    version,
    op: "update",
    actions,
    counters: c,
    dataFiles,
    deletionVectors,
    logText:
      "Deletion-vector UPDATE of " +
      updatedIds.length +
      " row(s) (" +
      updatedIds.join(", ") +
      " → status=" +
      UPDATE_STATUS +
      ") → " +
      newDvIds.length +
      " DV(s) + " +
      newFileIds.length +
      " new file(s), version " +
      version +
      ".",
    lastStep: {
      op: "update",
      title: "Deletion-vector UPDATE → version " + version,
      body:
        "With deletion vectors, UPDATE does not rewrite whole files. It masks the old row versions in place with a DV and writes a small new file holding just the changed rows. Readers subtract the DV and union the new file: much less write amplification than copy-on-write." +
        (upgraded ? " Enabling DVs bumps the table protocol to reader 3 / writer 7." : ""),
      bullets: [
        "set status=" + UPDATE_STATUS + " on " + updatedIds.length + " row(s)",
        newDvIds.length + " DV(s) mask the old rows in " + targets.length + " file(s) (left on disk)",
        newFileIds.length + " small file(s) hold the new row versions",
        upgraded
          ? "protocol upgraded → reader 3 / writer 7 (deletionVectors)"
          : "protocol already supports deletionVectors",
      ],
    },
  });
}

// ---- optimize (bin-packing compaction) ---------------------------------

export function optimize(s: TableState): TableState {
  const liveMap = liveFilesAt(s, s.current);
  // OPTIMIZE bin-packs *within* each partition — it never mixes partitions into one file.
  const byPartition = new Map<string, string[]>();
  for (const id of liveMap.keys()) {
    const part = s.dataFiles[id]?.partition ?? "";
    const ids = byPartition.get(part) ?? [];
    ids.push(id);
    byPartition.set(part, ids);
  }
  // A partition is worth rewriting only if it holds >1 file or a deletion vector to apply.
  const targets = [...byPartition.entries()].filter(
    ([, ids]) => ids.length > 1 || ids.some((id) => liveMap.get(id)),
  );
  if (!targets.length) {
    return {
      ...s,
      lastStep: {
        op: "optimize",
        title: "Nothing worth optimizing",
        body: "OPTIMIZE pays off when a partition holds several small files (or deletion vectors to apply). Append a few more times, then optimize.",
        bullets: [],
      },
    };
  }
  const version = s.current + 1;
  const c = { ...s.counters };
  const dataFiles = { ...s.dataFiles };
  const actions: Action[] = [];
  const removedIds: string[] = [];
  const addedIds: string[] = [];
  let hasDv = false;
  let liveRows = 0;
  for (const [partition, ids] of targets.sort((a, b) => a[0].localeCompare(b[0]))) {
    const records: OrderRecord[] = [];
    let size = 0;
    for (const id of ids) {
      const f = s.dataFiles[id];
      if (!f) continue;
      const dvId = liveMap.get(id);
      const masked = dvId ? new Set(s.deletionVectors[dvId]?.deletedIds ?? []) : null;
      if (dvId) hasDv = true;
      size += f.size || 0;
      for (const r of f.records) if (!(masked && masked.has(r.order_id))) records.push({ ...r });
      actions.push({ kind: "remove", path: id, dataChange: false });
      removedIds.push(id);
    }
    liveRows += records.length;
    if (!records.length) continue; // every row masked away — just drop the files
    c.d++;
    const cid = "d" + c.d;
    addedIds.push(cid);
    dataFiles[cid] = {
      id: cid,
      records,
      size: Math.max(2, size),
      partition,
      born: version,
      schemaId: s.schemaId,
      stats: computeStats(records),
      optimized: true,
    };
    actions.push({ kind: "add", path: cid, dataChange: false });
  }
  actions.push({
    kind: "commitInfo",
    operation: "OPTIMIZE",
    metrics: { numRemovedFiles: removedIds.length, numAddedFiles: addedIds.length },
  });
  return commit(s, {
    version,
    op: "optimize",
    actions,
    counters: c,
    dataFiles,
    logText:
      "Optimized " +
      removedIds.length +
      " file(s) across " +
      targets.length +
      " partition(s)" +
      (hasDv ? " (applying deletion vectors)" : "") +
      " → " +
      addedIds.length +
      " file(s), version " +
      version +
      ".",
    lastStep: {
      op: "optimize",
      title: "OPTIMIZE → version " + version,
      body: "OPTIMIZE bin-packs small files into one per partition, applying any deletion vectors as it goes — it never mixes partitions. It is a `dataChange: false` commit: the logical table is unchanged, so streaming readers can skip it. The old files stay on disk until VACUUM, so time travel keeps working.",
      bullets: [
        removedIds.length +
          " file(s) in " +
          targets.length +
          " partition(s) rewritten into " +
          addedIds.length +
          " file(s): " +
          (addedIds.join(", ") || "none"),
        hasDv
          ? "deletion vectors baked in; " + liveRows + " live rows remain"
          : liveRows + " live rows repacked",
        "commit marked dataChange: false (no logical change)",
        "old files persist until you VACUUM",
      ],
    },
  });
}

// ---- vacuum -------------------------------------------------------------

/** Physically delete tombstoned files no longer reachable from the current version. Not a new version. */
export function vacuum(s: TableState): TableState {
  const keep = new Set(liveFilesAt(s, s.current).keys());
  const keepDvs = new Set(
    [...liveFilesAt(s, s.current).values()].filter((dv): dv is string => !!dv),
  );
  const gcD = Object.keys(s.dataFiles).filter((id) => !keep.has(id)).length;
  const gcX = Object.keys(s.deletionVectors).filter((id) => !keepDvs.has(id)).length;
  if (gcD === 0 && gcX === 0) {
    return {
      ...s,
      lastStep: {
        op: "vacuum",
        title: "Nothing to vacuum",
        body: "Every file on disk is still referenced by the current version. Run a DELETE or OPTIMIZE (which tombstone files), then VACUUM to reclaim them.",
        bullets: [],
      },
    };
  }
  const dataFiles: TableState["dataFiles"] = {};
  for (const id of keep) if (s.dataFiles[id]) dataFiles[id] = s.dataFiles[id];
  const deletionVectors: TableState["deletionVectors"] = {};
  for (const id of keepDvs) if (s.deletionVectors[id]) deletionVectors[id] = s.deletionVectors[id];
  return {
    ...s,
    dataFiles,
    deletionVectors,
    selected: s.current,
    inspect: null,
    log: [
      {
        v: s.current,
        op: "vacuum",
        text:
          "VACUUM removed " +
          gcD +
          " tombstoned data file(s) and " +
          gcX +
          " deletion vector(s) from disk.",
      },
      ...s.log,
    ],
    lastStep: {
      op: "vacuum",
      title: "VACUUM reclaimed " + (gcD + gcX) + " file(s)",
      body: "VACUUM physically deletes data files that were tombstoned (removed) and are older than the retention window (default 7 days; this demo uses 0 so you see the effect immediately). It writes no commit — the log is unchanged. But time travel to older versions that needed those files now breaks: their data is gone.",
      bullets: [
        gcD + " data file(s) deleted from disk",
        gcX + " deletion vector(s) cleaned up",
        "no new version — VACUUM does not commit to the log",
        "default retention is 7 days; here it is 0 for the demo",
        "time travel to versions needing the deleted files no longer works",
      ],
    },
  };
}

// ---- checkpoint ---------------------------------------------------------

/** Write a checkpoint snapshotting the current version's live-file set. Not a new version. */
export function checkpoint(s: TableState): TableState {
  if (s.checkpoints.some((cp) => cp.version === s.current)) {
    return {
      ...s,
      lastStep: {
        op: "checkpoint",
        title: "Checkpoint already exists",
        body:
          "Version " +
          s.current +
          " already has a checkpoint. Make a few more commits, then checkpoint again.",
        bullets: [],
      },
    };
  }
  const liveFiles = [...liveFilesAt(s, s.current).entries()].map(([path, dv]) => ({ path, dv }));
  const cp: Checkpoint = { version: s.current, liveFiles, size: liveFiles.length };
  return {
    ...s,
    checkpoints: [...s.checkpoints, cp],
    log: [
      {
        v: s.current,
        op: "checkpoint",
        text:
          "Wrote _delta_log/…" +
          String(s.current).padStart(4, "0") +
          ".checkpoint.parquet (" +
          liveFiles.length +
          " live file(s)); updated _last_checkpoint.",
      },
      ...s.log,
    ],
    lastStep: {
      op: "checkpoint",
      title: "Checkpoint at version " + s.current,
      body: "A checkpoint is a Parquet snapshot of the whole table state (all live add actions) at one version. Delta writes one automatically every ~10 commits. Readers then start from the checkpoint and replay only the commits after it, instead of replaying the entire log from version 0.",
      bullets: [
        "snapshot of " + liveFiles.length + " live file(s) at version " + s.current,
        "_last_checkpoint now points here",
        "readers replay only versions after " + s.current,
        "no new table version — checkpoints are an optimization, not data",
      ],
    },
  };
}

// ---- schema evolution ---------------------------------------------------

/**
 * Evolve the schema by one version. Unlike Iceberg (a metadata-only bump with no
 * snapshot), in Delta a schema change is a real commit: a new version whose only
 * actions are an updated `metaData` (and, when the change needs a table feature like
 * column mapping or type widening, a `protocol` upgrade). No data is rewritten.
 */
export function evolveSchema(s: TableState): TableState {
  const next = s.schemaId + 1;
  if (next >= SCHEMA_DEFS.length) {
    return {
      ...s,
      lastStep: {
        op: "schema",
        title: "Already at the latest schema",
        body: "Every schema change in this demo has been applied. Column-mapping ids are never reused, so a dropped column cannot come back — reset the table to start the sequence over.",
        bullets: [],
      },
    };
  }
  const def = SCHEMA_DEFS[next];
  const version = s.current + 1;
  const proto = protocolAt(s, s.current);
  const feature = def.change.feature;
  const needsFeature = !!feature && !proto?.features.includes(feature);
  const actions: Action[] = [];
  if (needsFeature) {
    // Adding a table feature moves the table onto table-features protocol (reader 3 / writer 7).
    const features = [...new Set([...(proto?.features ?? []), feature!])];
    actions.push({
      kind: "protocol",
      minReader: Math.max(3, proto?.minReader ?? 1),
      minWriter: Math.max(7, proto?.minWriter ?? 2),
      features,
    });
  }
  actions.push({
    kind: "metaData",
    schema: schemaColNames(next),
    partitionBy: PARTITION_COLS,
    schemaId: next,
  });
  actions.push({ kind: "commitInfo", operation: def.change.operation, metrics: { numColumns: def.fields.length } });
  const featureNote = needsFeature
    ? feature === "columnMapping"
      ? "enabled column mapping (reader 3 / writer 7) so the change is metadata-only"
      : "enabled type widening (writer feature) so old files need no rewrite"
    : "no protocol change needed";
  const committed = commit(s, {
    version,
    op: "schema",
    actions,
    counters: s.counters,
    logText: "Schema evolution: " + def.change.text + " → metaData at version " + version + ".",
    lastStep: {
      op: "schema",
      title: "Schema evolution → schema-v" + next,
      body:
        "Changing the schema commits a new version carrying a fresh `metaData` action — no data files are rewritten. " +
        (def.change.kind === "add"
          ? "Adding a column is safe by name: older files simply have no value for it, so it reads back as null."
          : def.change.kind === "widen"
            ? "Widening a type needs the `typeWidening` feature; existing files keep their narrower physical type and are promoted on read."
            : "Renaming or dropping a column needs column mapping, which pins a stable id/physical name to each column so old files resolve without a rewrite."),
      bullets: [
        def.change.text,
        featureNote,
        "new version " + version + " — the change is a commit, not a metadata-only bump (unlike Iceberg)",
        "existing data files are untouched; they resolve by column id at read time",
      ],
    },
  });
  return { ...committed, schemaId: next, schemas: [...s.schemas, next] };
}

// ---- table reset & UI state --------------------------------------------

export function reset(s: TableState): TableState {
  return { ...initialState(), level: s.level, deleteMode: s.deleteMode };
}

export function setLevel(s: TableState, level: DetailLevel): TableState {
  return {
    ...s,
    level,
    qActive: level === "advanced" ? s.qActive : false,
    deleteMode: level === "advanced" ? s.deleteMode : "cow",
  };
}

export function setDeleteMode(s: TableState, mode: DeleteMode): TableState {
  return { ...s, deleteMode: mode };
}

export function jumpCurrent(s: TableState): TableState {
  return { ...s, selected: s.current };
}

export function selectVersion(s: TableState, version: number): TableState {
  return { ...s, selected: version };
}

export function openInspect(s: TableState, kind: NodeKind, id: string | null): TableState {
  return { ...s, inspect: { kind, id } };
}

export function closeInspect(s: TableState): TableState {
  return { ...s, inspect: null };
}

// ---- append-rows field --------------------------------------------------

export function rowsInc(s: TableState): TableState {
  return { ...s, appendRows: Math.min(999, (parseInt(String(s.appendRows), 10) || 0) + 1) };
}

export function rowsDec(s: TableState): TableState {
  return { ...s, appendRows: Math.max(1, (parseInt(String(s.appendRows), 10) || 1) - 1) };
}

export function rowsInput(s: TableState, value: string): TableState {
  const d = digits(value);
  return { ...s, appendRows: d === "" ? "" : Math.min(999, parseInt(d, 10)) };
}

// ---- query planner field -----------------------------------------------

export function setQueryCol(s: TableState, col: QueryColumn): TableState {
  return { ...s, q: { ...s.q, col } };
}

export function setQueryOp(s: TableState, op: QueryOp): TableState {
  return { ...s, q: { ...s.q, op } };
}

export function setQueryVal(s: TableState, val: string): TableState {
  return { ...s, q: { ...s.q, val } };
}

export function runQuery(s: TableState): TableState {
  return s.q && s.q.val !== "" && s.q.val != null ? { ...s, qActive: true } : s;
}

export function clearQuery(s: TableState): TableState {
  return { ...s, qActive: false };
}
