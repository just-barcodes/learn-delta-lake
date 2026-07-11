import { clock } from "./ids";
import { genRecords, type OrderIdCounter } from "./records";
import { BASE_PROTOCOL, PARTITION_COLS, SCHEMA_COLS } from "./schema";
import { computeStats } from "./stats";
import type { TableState } from "./types";

/**
 * The table's starting point: commit 0 holds a `protocol` action, a `metaData`
 * action (schema + partitioning), and two `add` actions for two data files. The
 * table is viewing version 0, its only committed version.
 */
export function initialState(): TableState {
  const ctr: OrderIdCounter = { oid: 1000 };
  const d1 = genRecords(3, { month: "2026-01" }, ctr);
  const d2 = genRecords(3, { month: "2026-01" }, ctr);
  return {
    commits: [
      {
        version: 0,
        op: "append",
        ts: clock(0),
        actions: [
          { kind: "protocol", ...BASE_PROTOCOL },
          { kind: "metaData", schema: SCHEMA_COLS, partitionBy: PARTITION_COLS },
          { kind: "add", path: "d1", dataChange: true },
          { kind: "add", path: "d2", dataChange: true },
          {
            kind: "commitInfo",
            operation: "CREATE TABLE AS SELECT",
            metrics: { numFiles: 2, numOutputRows: 6 },
          },
        ],
      },
    ],
    checkpoints: [],
    dataFiles: {
      d1: {
        id: "d1",
        records: d1,
        size: 4,
        partition: "2026-01",
        born: 0,
        stats: computeStats(d1),
      },
      d2: {
        id: "d2",
        records: d2,
        size: 4,
        partition: "2026-01",
        born: 0,
        stats: computeStats(d2),
      },
    },
    deletionVectors: {},
    current: 0,
    selected: 0,
    deleteMode: "cow",
    inspect: null,
    picker: null,
    appendRows: 6,
    q: { col: "amount", op: ">=", val: "" },
    qActive: false,
    level: "medium",
    counters: { d: 2, x: 0, oid: ctr.oid },
    log: [
      {
        v: 0,
        op: "append",
        text: "Created table + wrote 2 data files (d1, d2) → version 0 (_delta_log/…0000.json).",
      },
    ],
    lastStep: {
      op: "append",
      title: "Table created at version 0",
      body: "A Delta table starts with commit 0. The commit file lists actions: a protocol, a metaData (schema + partitioning), and one add per data file. The table's state at any version is the replay of every commit up to it.",
      bullets: [
        "2 data files on disk (d1, d2), 6 rows",
        "_delta_log/…0000.json holds protocol + metaData + 2 add actions",
        "current version → 0",
      ],
    },
  };
}
