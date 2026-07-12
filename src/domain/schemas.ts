import type { OrderRecord } from "./types";

/**
 * One column in a schema version. `id` is the Delta column-mapping field id: once
 * column mapping is enabled it is stable and never reused, so renames/drops become
 * metadata-only (readers resolve old files by id, not by name).
 */
export interface SchemaField {
  id: number;
  /** Display/column name. Changes on a rename; the id stays put. */
  name: string;
  /** Delta/Spark type string, e.g. "long" or "decimal(10,2)". */
  type: string;
  nullable: boolean;
  /** Which OrderRecord property backs this field (unchanged by a rename). */
  key: keyof OrderRecord;
  align: "left" | "right";
  mono: boolean;
}

/** What changed relative to the previous schema version, for logs and the explainer. */
export interface SchemaChange {
  kind: "create" | "add" | "rename" | "drop" | "widen";
  /** Present-tense phrasing of the pending change, for the toolbar button. */
  verb: string;
  /** Past-tense phrasing of the applied change, for the commit log and explainer. */
  text: string;
  /**
   * The Delta table feature this change requires, if any. ADD COLUMN needs none;
   * RENAME/DROP need `columnMapping`; a type change needs `typeWidening`.
   */
  feature?: "columnMapping" | "typeWidening";
  /** The Delta command that produced the commit (its `commitInfo.operation`). */
  operation: string;
}

/** A schema version: its columns, the high-water field id, and how it got here. */
export interface SchemaDef {
  fields: SchemaField[];
  /** delta.columnMapping.maxColumnId: the highest field id ever assigned (grows, never shrinks). */
  maxColumnId: number;
  change: SchemaChange;
}

// Field builders. Field ids are fixed; only name/type may vary across versions.
const orderId = (): SchemaField => ({
  id: 1,
  name: "order_id",
  type: "long",
  nullable: false,
  key: "order_id",
  align: "right",
  mono: true,
});
const customer = (name = "customer"): SchemaField => ({
  id: 2,
  name,
  type: "string",
  nullable: true,
  key: "customer",
  align: "left",
  mono: false,
});
const amount = (type = "decimal(10,2)"): SchemaField => ({
  id: 3,
  name: "amount",
  type,
  nullable: true,
  key: "amount",
  align: "right",
  mono: true,
});
const orderDate = (): SchemaField => ({
  id: 4,
  name: "order_date",
  type: "date",
  nullable: true,
  key: "order_date",
  align: "left",
  mono: true,
});
const status = (): SchemaField => ({
  id: 5,
  name: "status",
  type: "string",
  nullable: true,
  key: "status",
  align: "left",
  mono: false,
});
const region = (): SchemaField => ({
  id: 6,
  name: "region",
  type: "string",
  nullable: true,
  key: "region",
  align: "left",
  mono: false,
});

/**
 * The schema versions the table evolves through, one commit each. Progression is
 * linear (not a rotation): a dropped column cannot come back, because re-adding it
 * would have to reuse a retired column-mapping id — which Delta never does.
 */
export const SCHEMA_DEFS: SchemaDef[] = [
  {
    change: { kind: "create", verb: "create the initial schema", text: "initial schema (5 columns)", operation: "CREATE TABLE" },
    maxColumnId: 5,
    fields: [orderId(), customer(), amount(), orderDate(), status()],
  },
  {
    change: {
      kind: "add",
      verb: "add a region column",
      text: "added column region (string) — no protocol change",
      operation: "ADD COLUMNS",
    },
    maxColumnId: 6,
    fields: [orderId(), customer(), amount(), orderDate(), status(), region()],
  },
  {
    change: {
      kind: "rename",
      verb: "rename customer → customer_name",
      text: "renamed customer → customer_name (needs column mapping)",
      feature: "columnMapping",
      operation: "RENAME COLUMN",
    },
    maxColumnId: 6,
    fields: [orderId(), customer("customer_name"), amount(), orderDate(), status(), region()],
  },
  {
    change: {
      kind: "drop",
      verb: "drop the status column",
      text: "dropped column status (id 5 retired, never reused)",
      feature: "columnMapping",
      operation: "DROP COLUMNS",
    },
    maxColumnId: 6,
    fields: [orderId(), customer("customer_name"), amount(), orderDate(), region()],
  },
  {
    change: {
      kind: "widen",
      verb: "widen amount → decimal(12,2)",
      text: "widened amount decimal(10,2) → decimal(12,2) (needs type widening)",
      feature: "typeWidening",
      operation: "CHANGE COLUMN",
    },
    maxColumnId: 6,
    fields: [orderId(), customer("customer_name"), amount("decimal(12,2)"), orderDate(), region()],
  },
];

/** True if field `id` existed in the schema version a file was written under. */
export function fieldInSchema(id: number, schemaId: number): boolean {
  return SCHEMA_DEFS[schemaId]?.fields.some((f) => f.id === id) ?? false;
}
