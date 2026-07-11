import { clock } from "./ids";
import { initialState } from "./initialState";
import { genRecords, type OrderIdCounter } from "./records";
import { deletedIdsAt, liveFilesAt, liveRecords, liveRowCount, protocolAt } from "./replay";
import { DV_PROTOCOL } from "./schema";
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
  return { ...s, picker: { selected: {}, n: 3 } };
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
  const del = deletedIdsAt(s, s.current);
  const rows: { oid: number; file: string }[] = [];
  for (const path of files.keys()) {
    for (const r of s.dataFiles[path]?.records ?? []) {
      if (!del.has(r.order_id)) rows.push({ oid: r.order_id, file: path });
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
  const masked = deletedIdsAt(s, s.current);
  const actions: Action[] = [];
  const newIds: string[] = [];
  let copied = 0;
  for (const target of targets) {
    const orig = s.dataFiles[target];
    if (!orig) continue;
    const drop = byFile.get(target)!;
    const survivors = orig.records.filter((r) => !drop.has(r.order_id) && !masked.has(r.order_id));
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

// ---- optimize (bin-packing compaction) ---------------------------------

export function optimize(s: TableState): TableState {
  const liveMap = liveFilesAt(s, s.current);
  const liveIds = [...liveMap.keys()];
  const hasDv = [...liveMap.values()].some((dv) => dv);
  if (liveIds.length < 2 && !hasDv) {
    return {
      ...s,
      lastStep: {
        op: "optimize",
        title: "Nothing worth optimizing",
        body: "OPTIMIZE pays off with several small files (or deletion vectors to apply). Append a few more times, then optimize.",
        bullets: [],
      },
    };
  }
  const version = s.current + 1;
  const c = { ...s.counters };
  const live = liveRecords(s, s.current).live;
  const totalSize = Math.max(
    2,
    liveIds.reduce((a, id) => a + (s.dataFiles[id]?.size || 0), 0),
  );
  const parts = new Set(liveIds.map((id) => s.dataFiles[id]?.partition));
  const partition = parts.size === 1 ? [...parts][0]! : "optimized";
  c.d++;
  const cid = "d" + c.d;
  const dataFiles = {
    ...s.dataFiles,
    [cid]: {
      id: cid,
      records: live.map((r) => ({ ...r })),
      size: totalSize,
      partition,
      born: version,
      stats: computeStats(live),
      optimized: true,
    },
  };
  const actions: Action[] = liveIds.map((id) => ({
    kind: "remove" as const,
    path: id,
    dataChange: false,
  }));
  actions.push({ kind: "add", path: cid, dataChange: false });
  actions.push({
    kind: "commitInfo",
    operation: "OPTIMIZE",
    metrics: { numRemovedFiles: liveIds.length, numAddedFiles: 1 },
  });
  return commit(s, {
    version,
    op: "optimize",
    actions,
    counters: c,
    dataFiles,
    logText:
      "Optimized " +
      liveIds.length +
      " file(s)" +
      (hasDv ? " (applying deletion vectors)" : "") +
      " into " +
      cid +
      " → version " +
      version +
      ".",
    lastStep: {
      op: "optimize",
      title: "OPTIMIZE → version " + version,
      body: "OPTIMIZE bin-packs many small files into one, applying any deletion vectors as it goes. It is a `dataChange: false` commit: the logical table is unchanged, so streaming readers can skip it. The old files stay on disk until VACUUM, so time travel keeps working.",
      bullets: [
        liveIds.length + " file(s) removed, 1 compacted file added: " + cid,
        hasDv
          ? "deletion vectors baked in; " + live.length + " live rows remain"
          : live.length + " live rows in one file",
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
      body: "VACUUM physically deletes data files that were tombstoned (removed) and are no longer reachable from the current version. It writes no commit — the log is unchanged. But time travel to older versions that needed those files now breaks: their data is gone.",
      bullets: [
        gcD + " data file(s) deleted from disk",
        gcX + " deletion vector(s) cleaned up",
        "no new version — VACUUM does not commit to the log",
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
