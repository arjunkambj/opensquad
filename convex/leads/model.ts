/**
 * Leads — the person-level lead the agent works (`prospects` is the backend
 * table; the UI says Contacts). PLAN §7.
 *
 * This domain owns the lead record and everything written alongside it: its
 * stage machine, approval, notes, research evidence and append-only event
 * history. It owns neither the agent that sources leads nor the outreach
 * that contacts them — nothing here spends money or schedules work.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  assertEpochMs,
  boundedLimit,
  domainError,
  EPOCH_MS_MIN,
  invalid,
} from "../lib/validators";
import type { LeadApproval, LeadStage } from "../lib/validators";
import { prospectFields } from "../schema";
import { v } from "convex/values";

export const vProspectDoc = v.object({
  _id: v.id("prospects"),
  _creationTime: v.number(),
  ...prospectFields,
});

export const vListPage = v.object({
  items: v.array(vProspectDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

type ListPageArgs = {
  workspaceId: Id<"workspaces">;
  stage?: LeadStage;
  approval?: LeadApproval;
  dueRange?: { from?: number; to?: number };
  unscheduled?: boolean;
  topScoreFirst?: boolean;
  cursor?: string | null;
  limit?: number;
};

/**
 * Every list mode is an exact index range — never a post-filtered page. The
 * modes and the index behind each:
 *
 *   due (`dueRange`): soonest-due first on `by_workspaceId_and_nextActionAt`.
 *   A lead with no due time cannot satisfy a range bound, so this mode never
 *   hides one behind a page that looks filtered — it appears in the default
 *   and `unscheduled` modes instead.
 *
 *   unscheduled: the complementary slice — leads with NO `nextActionAt`.
 *
 *   score (`topScoreFirst`): best leads first on
 *   `by_workspaceId_and_scoreKey`. `scoreKey` is the denormalised mirror of
 *   `research.aiScore`; unresearched leads have none and sort below, which is
 *   exactly the "scored first, the rest one click away" order of PLAN §3.
 *
 *   stage / approval: the Contacts filters, each on its own index.
 *
 *   default: the whole workspace by next-action time, most recent first.
 *
 * Unsupported combinations REFUSE rather than silently post-filter: the
 * schema declares an index per enabled combination, and a filter pair with no
 * index is added deliberately or not at all.
 */
export async function listPage(
  ctx: QueryCtx,
  args: ListPageArgs,
): Promise<typeof vListPage.type> {
  const paginate = {
    numItems: boundedLimit(args.limit),
    cursor: args.cursor ?? null,
  };
  const exclusive = [
    args.stage !== undefined,
    args.approval !== undefined,
    args.dueRange !== undefined,
    args.unscheduled === true,
    args.topScoreFirst === true,
  ].filter(Boolean).length;
  if (exclusive > 1) {
    throw invalid(
      "stage, approval, dueRange, unscheduled and topScoreFirst are separate list modes — no index supports combining them",
    );
  }

  if (args.unscheduled === true) {
    // `undefined` sorts below every bound on this index, and every stored
    // `nextActionAt` is ≥ EPOCH_MS_MIN, so `lt(EPOCH_MS_MIN)` names exactly
    // the rows with no due time — the unscheduled state as a first-class
    // slice rather than a sentinel date the reader has to know about.
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) =>
        q.eq("workspaceId", args.workspaceId).lt("nextActionAt", EPOCH_MS_MIN),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.dueRange !== undefined) {
    const from =
      args.dueRange.from === undefined
        ? undefined
        : assertEpochMs(args.dueRange.from, "dueRange.from");
    const to =
      args.dueRange.to === undefined
        ? undefined
        : assertEpochMs(args.dueRange.to, "dueRange.to");
    if (from !== undefined && to !== undefined && from > to) {
      throw invalid("dueRange.from must not be after dueRange.to");
    }
    // A lead with NO `nextActionAt` stores `undefined` in the index, which
    // sorts below every bound — `lte(to)` alone would return undated leads as
    // "due". The lower bound is therefore always present: the caller's
    // `from`, or 0 meaning "has a due date at all".
    const lower = from ?? 0;
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) => {
        const scoped = q
          .eq("workspaceId", args.workspaceId)
          .gte("nextActionAt", lower);
        return to === undefined ? scoped : scoped.lte("nextActionAt", to);
      })
      .order("asc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.topScoreFirst === true) {
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_scoreKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const approval = args.approval;
  if (approval !== undefined) {
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_approval", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("approval", approval),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const stage = args.stage;
  const result =
    stage !== undefined
      ? await ctx.db
          .query("prospects")
          .withIndex("by_workspaceId_and_stage_and_updatedAt", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("stage", stage),
          )
          .order("desc")
          .paginate(paginate)
      : await ctx.db
          .query("prospects")
          .withIndex("by_workspaceId_and_nextActionAt", (q) =>
            q.eq("workspaceId", args.workspaceId),
          )
          .order("desc")
          .paginate(paginate);
  return {
    items: result.page,
    cursor: result.isDone ? null : result.continueCursor,
    hasMore: !result.isDone,
  };
}

/**
 * Load a lead for a write. A missing row and a row in another workspace are
 * the same NOT_FOUND — the read must never reveal another workspace's data.
 */
export async function loadProspectForWrite(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "prospect not found");
  }
  return prospect;
}

/** Re-read a patched lead; absence inside the writing transaction is a defect. */
export async function reread(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const row = await ctx.db.get("prospects", prospectId);
  if (row === null) {
    throw domainError("NOT_FOUND", "prospect not found after write");
  }
  return row;
}
