/** The table's column schema, in display order. */
export const ORDER_COLS = [
  { key: "order_id", label: "order_id", align: "right", mono: true },
  { key: "customer", label: "customer", align: "left", mono: false },
  { key: "amount", label: "amount", align: "right", mono: true },
  { key: "order_date", label: "order_date", align: "left", mono: true },
  { key: "status", label: "status", align: "left", mono: false },
] as const;

/** One field in the table's logical schema, as recorded in the `metaData` action's schemaString. */
export interface SchemaField {
  name: string;
  /** Delta/Spark type string, e.g. "long" or "decimal(10,2)". */
  type: string;
  nullable: boolean;
  /** For a generated column: the SQL expression Delta stores as `delta.generationExpression`. */
  generated?: string;
}

/**
 * The table's logical schema. Delta has no hidden partition transforms, so the
 * partition column `order_month` is a real column of the table — modelled here as a
 * *generated* column derived from `order_date`. Its value lives in each `add`
 * action's `partitionValues`, not in the Parquet row data, which is why it is absent
 * from ORDER_COLS (the physical row grid).
 */
export const SCHEMA_FIELDS: SchemaField[] = [
  { name: "order_id", type: "long", nullable: false },
  { name: "customer", type: "string", nullable: true },
  { name: "amount", type: "decimal(10,2)", nullable: true },
  { name: "order_date", type: "date", nullable: true },
  { name: "status", type: "string", nullable: true },
  {
    name: "order_month",
    type: "string",
    nullable: true,
    generated: "date_format(order_date, 'yyyy-MM')",
  },
];

/** Schema column names, as recorded in the `metaData` action (includes the generated partition column). */
export const SCHEMA_COLS = SCHEMA_FIELDS.map((f) => f.name);

/** The table is partitioned by a generated month column (Delta has no hidden transforms). */
export const PARTITION_COLS = ["order_month"];

/** Stable table id used in the `metaData` action. */
export const TABLE_ID = "a3f9c1e2-7b44-4d18-9e5a-2c6f0b8d51aa";

/** Reader/writer protocol for a plain table (no deletion vectors yet). */
export const BASE_PROTOCOL = { minReader: 1, minWriter: 2, features: [] as string[] };

/** Protocol required once deletion vectors are enabled (first DV delete upgrades to this). */
export const DV_PROTOCOL = { minReader: 3, minWriter: 7, features: ["deletionVectors"] };
