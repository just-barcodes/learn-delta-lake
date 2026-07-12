import { SCHEMA_DEFS } from "./schemas";

/**
 * The generated partition column. Delta has no hidden transforms, so the partition
 * column `order_month` is a real column of the table — derived from `order_date`.
 * Its value lives in each `add` action's partitionValues, not in the Parquet row
 * data, so it never appears in a data-file's row grid.
 */
export const GEN_MONTH = {
  name: "order_month",
  type: "string",
  nullable: true,
  generated: "date_format(order_date, 'yyyy-MM')",
} as const;

/** The metaData `schema` column names at a schema version: physical fields + the generated partition column. */
export function schemaColNames(schemaId: number): string[] {
  return [...SCHEMA_DEFS[schemaId].fields.map((f) => f.name), GEN_MONTH.name];
}

/** The table is partitioned by the generated month column (Delta has no hidden transforms). */
export const PARTITION_COLS = [GEN_MONTH.name];

/** Stable table id used in the `metaData` action. */
export const TABLE_ID = "a3f9c1e2-7b44-4d18-9e5a-2c6f0b8d51aa";

/** Reader/writer protocol for a plain table (no deletion vectors yet). */
export const BASE_PROTOCOL = { minReader: 1, minWriter: 2, features: [] as string[] };

/** Protocol required once deletion vectors are enabled (first DV delete upgrades to this). */
export const DV_PROTOCOL = { minReader: 3, minWriter: 7, features: ["deletionVectors"] };
