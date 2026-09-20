/**
 * The clean-slate partition of the application schema — MIGRATION.md §6.3.
 *
 * The cutover keeps three tables and clears everything else. Which tables
 * "everything else" means is DERIVED from the schema rather than written out
 * here: a table added to `convex/schema.ts` after this file was written is
 * cleared by default. That is the safe direction to be wrong in — forgetting
 * to clear a new table would carry pre-pivot rows into the new model, while
 * clearing one that did not need clearing costs nothing on a clean slate.
 *
 * Tables that are no longer in the schema at all (`missions`, `runs`,
 * `decisions`, `missionProspects`, `missionComments`, `providerConnections`,
 * `runtimeConnections`, `runtimeControlRequests`) are NOT reachable from
 * here — `ctx.db.query` only accepts names in the data model. Their rows are
 * unreachable by application code and are deleted from the dashboard; the
 * runbook in `plan/migration-log.md` says so explicitly.
 */
import type { TableNames } from "../_generated/dataModel";
import schema from "../schema";

/**
 * The two tables the clean-slate cutover keeps, documents and `_id`s intact.
 * They are kept together or not at all: a suppression is owned by an `orgId`,
 * and an opt-out only suppresses anything while the org that owns it still
 * exists. Re-importing suppressions into a cleared org table would produce
 * rows that suppress nothing (MIGRATION.md §6 preamble).
 */
export const KEPT_TABLES = [
  "orgs",
  "suppressions",
] as const satisfies readonly TableNames[];

export type KeptTable = (typeof KEPT_TABLES)[number];
export type ClearableTable = Exclude<TableNames, KeptTable>;

const KEPT: ReadonlySet<string> = new Set<string>(KEPT_TABLES);

/**
 * The literal a caller must pass to run the destructive clear. It is spelled
 * out rather than a boolean so that `npx convex run … '{}'`, a mistyped
 * dashboard argument or an accidental re-run of a shell line cannot empty a
 * deployment: the argument validator rejects anything else.
 */
export const CLEAR_CONFIRMATION =
  "yes-clear-every-app-table-except-orgs-suppressions";

function isClearable(name: TableNames): name is ClearableTable {
  return !KEPT.has(name);
}

/**
 * Every clearable table, in schema declaration order.
 *
 * `Object.keys` loses the key type, so the result is re-asserted as the table
 * union before it is narrowed. The assertion is sound by construction:
 * `schema.tables` is exactly what the data model is generated from.
 */
export function clearableTables(): readonly ClearableTable[] {
  const names = Object.keys(schema.tables) as TableNames[];
  return names.filter(isClearable);
}

/** Whether `name` is a schema table this migration is allowed to empty. */
export function isClearableTableName(name: string): name is ClearableTable {
  return Object.hasOwn(schema.tables, name) && !KEPT.has(name);
}
