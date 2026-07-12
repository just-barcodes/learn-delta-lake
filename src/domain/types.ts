// Pure domain model for a simulated Delta Lake table. No React, no DOM.
//
// Delta's metadata is an ordered *log* of commits (_delta_log/NNN.json), each a
// list of actions. Table state at any version is the replay of every commit up to
// it: (all `add`s) − (all `remove`s), read through the latest metaData/protocol.

/** The operations a commit can represent. `vacuum` and `checkpoint` mutate the log without adding a version. */
export type Operation =
  "append" | "delete" | "update" | "optimize" | "vacuum" | "checkpoint" | "schema";

/** DELETE strategy: copy-on-write rewrites files; deletion-vector masks row positions (merge-on-read). */
export type DeleteMode = "cow" | "dv";

/** A single row in the `orders` table. `amount` is a display string like "CHF 197.07". */
export interface OrderRecord {
  order_id: number;
  customer: string;
  amount: string;
  order_date: string;
  status: string;
  /** Added by schema evolution; older files predate it and read back as null. */
  region: string;
}

/** The queryable columns and their comparison operators used by the data-skipping planner. */
export type QueryColumn = "order_id" | "amount" | "order_date";
export type QueryOp = "=" | ">" | ">=" | "<" | "<=";

/**
 * Per-column min/max/nullCount plus row count, exactly as Delta records inline in
 * each `add` action's `stats`. Computed once at write time and read by the planner
 * to skip files without opening them.
 */
export interface FileStats {
  numRecords: number;
  min: { order_id: number; amount: number; order_date: string };
  max: { order_id: number; amount: number; order_date: string };
  nullCount: { order_id: number; amount: number; order_date: number };
}

/** An immutable Parquet data file. `born` is the version that first `add`ed it. */
export interface DataFile {
  id: string;
  records: OrderRecord[];
  size: number;
  /** partitionValues, e.g. "2026-01" for order_month. */
  partition: string;
  born: number;
  /** The schema version this file was written under; older ones resolve columns by id at read time. */
  schemaId: number;
  /** Column stats recorded when the file was written (see FileStats). */
  stats: FileStats;
  optimized?: boolean;
}

/** A deletion vector: masks row positions within one data file (merge-on-read delete). */
export interface DeletionVector {
  id: string;
  /** Data-file id it masks. */
  target: string;
  deletedIds: number[];
  size: number;
  born: number;
}

/** One entry inside a commit file. A discriminated union over Delta's action types. */
export type Action =
  | { kind: "protocol"; minReader: number; minWriter: number; features: string[] }
  | { kind: "metaData"; schema: string[]; partitionBy: string[]; schemaId: number }
  | { kind: "add"; path: string; dataChange: boolean; dv?: string | null }
  | { kind: "remove"; path: string; dataChange: boolean }
  | { kind: "commitInfo"; operation: string; metrics: Record<string, number> };

/** One _delta_log/NNN.json file: an ordered list of actions committed atomically. */
export interface Commit {
  version: number;
  op: Operation;
  ts: string;
  actions: Action[];
}

/** A NNN.checkpoint.parquet: the materialized live-file set through `version`. */
export interface Checkpoint {
  version: number;
  /** Each live file and its active deletion vector, so the checkpoint replays correctly. */
  liveFiles: { path: string; dv: string | null }[];
  size: number;
}

/** The active query-planner filter. `val` is empty until the user types one. */
export interface Query {
  col: QueryColumn;
  op: QueryOp;
  val: string;
}

/** Open state for the row-picker modal, shared by DELETE and UPDATE. `n` is the "select random N" count. */
export interface Picker {
  /** Whether the picked rows will be deleted or updated. */
  mode: "delete" | "update";
  /** Map of order_id -> data-file id for the currently-checked rows. */
  selected: Record<number, string>;
  n: number | "";
}

/** The "What just happened" explainer produced by every operation. */
export interface LastStep {
  op: Operation;
  title: string;
  body: string;
  bullets: string[];
}

/** One line in the commit log. `v` is the version the entry belongs to. */
export interface LogEntry {
  v: number;
  op: Operation;
  text: string;
}

/** Monotonic counters that back generated file/deletion-vector/order ids. */
export interface Counters {
  d: number;
  x: number;
  oid: number;
}

export type DetailLevel = "simple" | "medium" | "advanced";

/** Which node the inspector modal is showing. */
export type NodeKind =
  "table" | "version" | "checkpoint" | "add" | "remove" | "meta" | "data" | "dv";

export interface Inspect {
  kind: NodeKind;
  id: string | null;
}

/** The complete table state. Everything the UI renders is derived from this. */
export interface TableState {
  /** The ordered transaction log. */
  commits: Commit[];
  /** Written checkpoints; the last one is pointed at by `_last_checkpoint`. */
  checkpoints: Checkpoint[];
  dataFiles: Record<string, DataFile>;
  deletionVectors: Record<string, DeletionVector>;
  /** The latest committed version. */
  current: number;
  /** The version currently being viewed (differs from `current` while time-travelling). */
  selected: number;
  /** The table's current schema version (advanced by schema evolution). */
  schemaId: number;
  /** Schema versions the table has moved through, in order (for the metaData history). */
  schemas: number[];
  /** DELETE strategy toggle (advanced level). */
  deleteMode: DeleteMode;
  inspect: Inspect | null;
  picker: Picker | null;
  appendRows: number | "";
  q: Query;
  qActive: boolean;
  level: DetailLevel;
  counters: Counters;
  log: LogEntry[];
  lastStep: LastStep;
}
