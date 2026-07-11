import type { Checkpoint, Commit, OrderRecord, TableState } from "./types";

// The heart of the app: reconstruct table state at any version by replaying the
// log. Live files at version N = (all `add`s 0..N) − (all `remove`s 0..N), started
// from the latest checkpoint ≤ N when one exists (so we *show* the reader shortcut).

export function commitAt(state: TableState, version: number): Commit | null {
  return state.commits.find((c) => c.version === version) ?? null;
}

/** The checkpoint with the highest version at or before `version`, or null. */
function latestCheckpoint(state: TableState, version: number): Checkpoint | null {
  let best: Checkpoint | null = null;
  for (const cp of state.checkpoints) {
    if (cp.version <= version && (!best || cp.version > best.version)) best = cp;
  }
  return best;
}

/** What a reader actually touches to reconstruct `version`: a checkpoint plus the tail commits. */
export interface ReplayPath {
  checkpoint: Checkpoint | null;
  /** Versions replayed after the checkpoint (or from 0 when there is none). */
  commits: number[];
}

export function replayPath(state: TableState, version: number): ReplayPath {
  const checkpoint = latestCheckpoint(state, version);
  const from = checkpoint ? checkpoint.version + 1 : 0;
  const commits = state.commits
    .filter((c) => c.version >= from && c.version <= version)
    .map((c) => c.version)
    .sort((a, b) => a - b);
  return { checkpoint, commits };
}

/** Live files at a version, as path → active deletion-vector id (or null for none). */
export function liveFilesAt(state: TableState, version: number): Map<string, string | null> {
  const files = new Map<string, string | null>();
  const { checkpoint, commits } = replayPath(state, version);
  if (checkpoint) {
    for (const f of checkpoint.liveFiles) files.set(f.path, f.dv);
  }
  for (const v of commits) {
    const c = commitAt(state, v);
    if (!c) continue;
    for (const a of c.actions) {
      if (a.kind === "add") files.set(a.path, a.dv ?? null);
      else if (a.kind === "remove") files.delete(a.path);
    }
  }
  return files;
}

/** The set of live data-file ids at a version. */
export function liveFileIds(state: TableState, version: number): Set<string> {
  return new Set(liveFilesAt(state, version).keys());
}

/** Order ids masked by deletion vectors on the live files at a version (merge-on-read deletes). */
export function deletedIdsAt(state: TableState, version: number): Set<number> {
  const set = new Set<number>();
  for (const dvId of liveFilesAt(state, version).values()) {
    if (!dvId) continue;
    for (const id of state.deletionVectors[dvId]?.deletedIds ?? []) set.add(id);
  }
  return set;
}

/** Materialize a version: records from its live files, split into live vs. masked-by-DV. */
export function liveRecords(
  state: TableState,
  version: number,
): { live: OrderRecord[]; deleted: OrderRecord[] } {
  const files = liveFilesAt(state, version);
  const del = deletedIdsAt(state, version);
  const live: OrderRecord[] = [];
  const deleted: OrderRecord[] = [];
  for (const path of files.keys()) {
    for (const r of state.dataFiles[path]?.records ?? []) {
      (del.has(r.order_id) ? deleted : live).push(r);
    }
  }
  return { live, deleted };
}

export function liveRowCount(state: TableState, version: number): number {
  return liveRecords(state, version).live.length;
}

/** The table schema + partitioning in effect at a version (latest `metaData` action ≤ version). */
export function metadataAt(
  state: TableState,
  version: number,
): { schema: string[]; partitionBy: string[] } | null {
  let found: { schema: string[]; partitionBy: string[] } | null = null;
  for (const c of state.commits) {
    if (c.version > version) continue;
    for (const a of c.actions) {
      if (a.kind === "metaData") found = { schema: a.schema, partitionBy: a.partitionBy };
    }
  }
  return found;
}

/** The reader/writer protocol in effect at a version (latest `protocol` action ≤ version). */
export function protocolAt(
  state: TableState,
  version: number,
): { minReader: number; minWriter: number; features: string[] } | null {
  let found: { minReader: number; minWriter: number; features: string[] } | null = null;
  for (const c of state.commits) {
    if (c.version > version) continue;
    for (const a of c.actions) {
      if (a.kind === "protocol") {
        found = { minReader: a.minReader, minWriter: a.minWriter, features: a.features };
      }
    }
  }
  return found;
}
