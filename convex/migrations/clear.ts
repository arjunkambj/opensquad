/**
 * The clear step of the clean-slate cutover — MIGRATION.md §6.3.
 *
 * Empties every application table except `workspaces`, `memberships` and
 * `suppressions`, in bounded batches, resumably, and only when the caller
 * spells out the confirmation literal.
 *
 * Batching, not `collect()`: a production table can hold more rows than one
 * Convex transaction may read or write, so each call takes one page, deletes
 * it and schedules the next. Taking "the first N rows that are still there"
 * rather than paginating with a cursor is what makes it resumable for free —
 * the rows a previous call deleted are simply no longer in front of us, so a
 * re-run after any kind of interruption continues where it stopped without
 * carrying state.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { boundedInt, invalid } from "../lib/validators";
import {
  CLEAR_CONFIRMATION,
  clearableTables,
  isClearableTableName,
  type ClearableTable,
} from "./tables";

const DEFAULT_CLEAR_BATCH_SIZE = 200;
const MAX_CLEAR_BATCH_SIZE = 1000;

/** Per-table cap for the progress query, so verification stays bounded. */
const PROGRESS_SCAN_CAP = 200;

function resumeIndex(
  order: readonly ClearableTable[],
  fromTable: string | undefined,
): number {
  if (fromTable === undefined) {
    return 0;
  }
  if (!isClearableTableName(fromTable)) {
    throw invalid(`${fromTable} is not a clearable schema table`);
  }
  const index = order.indexOf(fromTable);
  // Unreachable while `isClearableTableName` and `clearableTables` read the
  // same schema, but an index of -1 would silently restart the whole sweep.
  if (index < 0) {
    throw invalid(`${fromTable} is not in the clear order`);
  }
  return index;
}

/**
 * Delete one batch of rows from the first non-empty clearable table at or
 * after `fromTable`, then schedule itself for the next batch.
 *
 * Returns after a single batch so the transaction stays small; `isDone` is
 * true only when a full pass found nothing left to delete.
 */
export const clearAppTables = internalMutation({
  args: {
    /** Destructive-operation guard; see `CLEAR_CONFIRMATION`. */
    confirm: v.literal(CLEAR_CONFIRMATION),
    /** Resume point. Omit to start at the first clearable table. */
    fromTable: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    /** Report the next batch without deleting anything or scheduling. */
    dryRun: v.optional(v.boolean()),
    /** Stop after this batch instead of scheduling the next one. */
    oneBatchOnly: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    /** The table this batch worked on, or null when nothing was left. */
    table: v.union(v.string(), v.null()),
    deleted: v.number(),
    /** Tables that may still hold rows, including `table` itself. */
    tablesRemaining: v.array(v.string()),
    isDone: v.boolean(),
    scheduledNext: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const batchSize =
      args.batchSize === undefined
        ? DEFAULT_CLEAR_BATCH_SIZE
        : boundedInt(args.batchSize, "batchSize", {
            min: 1,
            max: MAX_CLEAR_BATCH_SIZE,
          });

    const order = clearableTables();
    const start = resumeIndex(order, args.fromTable);

    for (let index = start; index < order.length; index += 1) {
      const table = order[index];
      const page = await ctx.db.query(table).take(batchSize);
      if (page.length === 0) {
        continue;
      }

      const tablesRemaining = [...order.slice(index)];
      if (dryRun) {
        return {
          dryRun: true,
          table,
          deleted: 0,
          tablesRemaining,
          isDone: false,
          scheduledNext: false,
        };
      }

      for (const doc of page) {
        // The id-only overload: the two-argument form rejects a union table
        // name by design, and `table` is a union here.
        await ctx.db.delete(doc._id);
      }

      const scheduledNext = args.oneBatchOnly !== true;
      if (scheduledNext) {
        await ctx.scheduler.runAfter(
          0,
          internal.migrations.clear.clearAppTables,
          {
            confirm: args.confirm,
            fromTable: table,
            batchSize,
            oneBatchOnly: args.oneBatchOnly,
          },
        );
      }

      return {
        dryRun: false,
        table,
        deleted: page.length,
        tablesRemaining,
        isDone: false,
        scheduledNext,
      };
    }

    return {
      dryRun,
      table: null,
      deleted: 0,
      tablesRemaining: [],
      isDone: true,
      scheduledNext: false,
    };
  },
});

/**
 * Read-only progress/verification for the clear step: how many rows each
 * clearable table still holds, counted up to `PROGRESS_SCAN_CAP` per table so
 * the query stays inside one transaction's read budget.
 *
 * `cleared` is the claim the runbook records; `truncated` names the tables
 * whose count hit the cap, so a "not empty" answer is never mistaken for an
 * exact remaining count.
 */
export const clearProgress = internalQuery({
  args: {},
  returns: v.object({
    cleared: v.boolean(),
    nonEmpty: v.array(v.object({ table: v.string(), atLeast: v.number() })),
    truncated: v.array(v.string()),
    keptTablesChecked: v.boolean(),
  }),
  handler: async (ctx) => {
    const nonEmpty: { table: string; atLeast: number }[] = [];
    const truncated: string[] = [];

    for (const table of clearableTables()) {
      const rows = await ctx.db.query(table).take(PROGRESS_SCAN_CAP + 1);
      if (rows.length === 0) {
        continue;
      }
      nonEmpty.push({ table, atLeast: Math.min(rows.length, PROGRESS_SCAN_CAP) });
      if (rows.length > PROGRESS_SCAN_CAP) {
        truncated.push(table);
      }
    }

    return {
      cleared: nonEmpty.length === 0,
      nonEmpty,
      truncated,
      // The kept tables are deliberately not counted here: `verify.ts` owns
      // the statement about them, and counting them here would invite reading
      // "cleared" as "the deployment is empty", which it must never mean.
      keptTablesChecked: false,
    };
  },
});
