/** The table's column schema, in display order. */
export const ORDER_COLS = [
  { key: "order_id", label: "order_id", align: "right", mono: true },
  { key: "customer", label: "customer", align: "left", mono: false },
  { key: "amount", label: "amount", align: "right", mono: true },
  { key: "order_date", label: "order_date", align: "left", mono: true },
  { key: "status", label: "status", align: "left", mono: false },
] as const;

/** Schema column names, as recorded in the `metaData` action. */
export const SCHEMA_COLS = ORDER_COLS.map((c) => c.key);

/** The table is partitioned by a literal month column (Delta has no hidden transforms). */
export const PARTITION_COLS = ["order_month"];

/** Stable table id used in the `metaData` action. */
export const TABLE_ID = "a3f9c1e2-7b44-4d18-9e5a-2c6f0b8d51aa";

/** Reader/writer protocol for a plain table (no deletion vectors yet). */
export const BASE_PROTOCOL = { minReader: 1, minWriter: 2, features: [] as string[] };

/** Protocol required once deletion vectors are enabled (first DV delete upgrades to this). */
export const DV_PROTOCOL = { minReader: 3, minWriter: 7, features: ["deletionVectors"] };
