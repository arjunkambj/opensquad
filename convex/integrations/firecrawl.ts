/**
 * OpenSquad ↔ Firecrawl boundary (P04 — bounded research spike).
 *
 * The registered `@firecrawl/firecrawl-convex@0.1.1` component owns the
 * provider transport: `lib.scrape`/`lib.map`/`lib.search` are direct v2 REST
 * calls, and `crawl.start` runs a durable crawl whose progress arrives either
 * through the signed component webhook mounted at `<site>/firecrawl/webhook`
 * (self-mounted via `httpPrefix: "/firecrawl/"` in convex.config.ts) or
 * through `mode: "poll"` for deployments Firecrawl cannot reach (local dev).
 *
 * This file is the ONLY app-side surface (integrations.md §G2 "Firecrawl
 * route"): a narrow, allow-listed internal wrapper. Everything exported is
 * internal — unreachable from clients and public HTTP. The employee-facing
 * OpenSquad research tool (P09) reads scoped results; it never receives a
 * Firecrawl credential or an arbitrary crawl primitive.
 *
 * Allow-list vs the full component client (deliberately NOT exported):
 *   - `firecrawl.map` / `firecrawl.search` — discovery-shaped; the primary
 *     route is Apollo discovery + targeted page research. Not needed here.
 *   - `firecrawl.cancelCrawl` / `resumeCrawl` / `deleteCrawl` — lifecycle
 *     management belongs to the owning workflow task (P09), not this spike.
 *
 * Component inspection notes (@firecrawl/firecrawl-convex@0.1.1 dist/):
 *   - `scrape` → POST {FIRECRAWL_API_URL}/v2/scrape; errors are ConvexError
 *     `{code:"firecrawl_request_failed", status, path, message}`; transient
 *     408/425/429/5xx retried ≤3 with backoff honoring Retry-After.
 *   - Webhook deliveries are double-guarded: `X-Firecrawl-Signature` HMAC
 *     over the raw body when FIRECRAWL_WEBHOOK_SECRET is set, PLUS a
 *     per-crawl `x-firecrawl-convex-token` header the component registers.
 *   - Crawl rows cap page bodies at Convex's 1MB document limit
 *     (`truncated: true`, `unstored` count) — never silently.
 */

import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { FunctionReference } from "convex/server";
import {
  assertEpochMs,
  computeResultDigest,
  domainError,
  invalid,
  normalizeHttpUrl,
  researchPageLimit,
  sha256Hex,
  vProviderOperationState,
  vRetrievedPage,
  RESEARCH_PAGES_PER_PROSPECT,
} from "../lib/validators";
import type { ProviderOperationState } from "../lib/validators";

/** Shared component client handle. `FIRECRAWL_API_KEY` /
 * `FIRECRAWL_WEBHOOK_SECRET` are bound to the component's typed env in
 * convex.config.ts and read inside component functions — never through args. */
export const firecrawl = new FirecrawlClient(components.firecrawl);

// The component's QueryCtx/MutationCtx/ActionCtx types (resolved under
// convex 1.45.0) expect the `(fn, args, options?: {transactionLimits})`
// ArgsAndOptions signature, while the real ctx exposes the single-argument
// OptionalRestArgs form — the same skew P05 documented for AgentMail. The
// component only ever calls runQuery/runMutation/runAction(fn, argsObject)
// (verified in dist/client/index.js), so these adapters drop the unused
// options element; runtime behavior is unchanged.
type ComponentQueryCtx = Parameters<typeof firecrawl.getCrawl>[0];
type ComponentActionCtx = Parameters<typeof firecrawl.scrape>[0];

/** Plain `(fn, args)` runner shape — what the component actually invokes at
 * runtime (verified: dist/client/index.js always calls runX(fn, argsObject)). */
type PlainQuery = (
  q: FunctionReference<"query">,
  args?: unknown,
) => Promise<unknown>;
type PlainMutation = (
  m: FunctionReference<"mutation">,
  args?: unknown,
) => Promise<unknown>;
type PlainAction = (
  a: FunctionReference<"action">,
  args?: unknown,
) => Promise<unknown>;

type CtxWithRunners = {
  runQuery: unknown;
  runMutation: unknown;
  runAction: unknown;
};

/** Rebind the real ctx's runners positionally for the component client's
 * skewed signature (drops the unsupported options element). The member-level
 * casts are the honest statement of verified runtime behavior — the declared
 * types disagree on rest-tuple shapes, not on capability. */
function asQueryCtx(ctx: { runQuery: unknown }): ComponentQueryCtx {
  const adapted = {
    runQuery: ((q, args) =>
      (ctx.runQuery as PlainQuery)(q, args)) satisfies PlainQuery,
  };
  return adapted as unknown as ComponentQueryCtx;
}

function asActionCtx(ctx: CtxWithRunners): ComponentActionCtx {
  const adapted = {
    runQuery: ((q, args) =>
      (ctx.runQuery as PlainQuery)(q, args)) satisfies PlainQuery,
    runMutation: ((m, args) =>
      (ctx.runMutation as PlainMutation)(m, args)) satisfies PlainMutation,
    runAction: ((a, args) =>
      (ctx.runAction as PlainAction)(a, args)) satisfies PlainAction,
  };
  return adapted as unknown as ComponentActionCtx;
}

// ---------------------------------------------------------------------------
// URL admission — OpenSquad-controlled fetch policy (architecture §9)
// ---------------------------------------------------------------------------

/**
 * Admit only public `http(s)` URLs with no userinfo and a publicly routable
 * literal hostname. The actual fetch is performed provider-side by Firecrawl,
 * so this guard is policy enforcement, not SSRF defense-in-depth — Convex
 * actions cannot resolve DNS, so hostname-to-private-IP rebinding is a known
 * residual limitation recorded in plan/evidence/P04.md. Provider-reported
 * source URLs are validated before returning evidence; this cannot prevent
 * Firecrawl from following a redirect before reporting the result.
 */
function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`URL scheme must be http(s), got ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("credential-bearing URLs are not allowed");
  }
  // A trailing DNS root dot does not make a local hostname public.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error(`local hostname not allowed: ${host}`);
  }
  // Literal-IP checks (dotted-quad v4 + bracketed v6).
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const privateV4 =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a === 0 ||
      a >= 224; // multicast/reserved
    if (privateV4) {
      throw new Error(`private/reserved IPv4 not allowed: ${host}`);
    }
  }
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    if (
      // Unspecified, loopback and IPv4-compatible/mapped addresses.
      v6.startsWith("::") ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("ff") || // multicast
      // fe80::/10 link-local + fec0::/10 site-local + the rest of the
      // reserved fe00::/8 space — all non-public for a fetch policy.
      v6.startsWith("fe") ||
      // NAT64 well-known prefix can embed a private IPv4 target.
      v6.startsWith("64:ff9b")
    ) {
      throw new Error(`private/reserved IPv6 not allowed: ${host}`);
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// Bounded scrape — the P04 probe primitive and the P09 contract seed
// ---------------------------------------------------------------------------

const EXCERPT_LIMIT = 4_000;

const vScrapeResult = v.object({
  url: v.string(),
  retrievedAt: v.string(),
  statusCode: v.optional(v.number()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  /** First EXCERPT_LIMIT chars of the page's main-content markdown. */
  markdownExcerpt: v.string(),
  markdownTruncated: v.boolean(),
  creditsUsed: v.optional(v.number()),
  cacheState: v.optional(v.string()),
  warning: v.optional(v.string()),
});

type ScrapeResult = Infer<typeof vScrapeResult>;

/**
 * Scrape exactly ONE validated public page (markdown, main content only).
 * This is the bounded operation the research slice uses for "homepage plus
 * up to two relevant pages per prospect": callers pass each approved URL
 * explicitly. There is deliberately no search/map/fan-out parameter.
 */
export const scrapePage = internalAction({
  args: { url: v.string() },
  returns: vScrapeResult,
  handler: async (ctx, args): Promise<ScrapeResult> => {
    const url = assertPublicHttpUrl(args.url);
    const doc = await firecrawl.scrape(asActionCtx(ctx), url.toString(), {
      formats: ["markdown"],
      onlyMainContent: true,
    });
    const markdown = typeof doc.markdown === "string" ? doc.markdown : "";
    const metadata = doc.metadata ?? {};
    for (const reportedUrl of [metadata.url, metadata.sourceURL]) {
      if (typeof reportedUrl === "string") assertPublicHttpUrl(reportedUrl);
    }
    const statusCode = metadata["statusCode"];
    return {
      url: url.toString(),
      retrievedAt: new Date().toISOString(),
      statusCode: typeof statusCode === "number" ? statusCode : undefined,
      title:
        typeof metadata["title"] === "string" ? metadata["title"] : undefined,
      description:
        typeof metadata["description"] === "string"
          ? metadata["description"]
          : undefined,
      markdownExcerpt: markdown.slice(0, EXCERPT_LIMIT),
      markdownTruncated: markdown.length > EXCERPT_LIMIT,
      creditsUsed:
        typeof metadata["creditsUsed"] === "number"
          ? metadata["creditsUsed"]
          : undefined,
      cacheState:
        typeof metadata["cacheState"] === "string"
          ? metadata["cacheState"]
          : undefined,
      warning: typeof doc.warning === "string" ? doc.warning : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Read-only crawl inspection (for the P09 Workflow-resume contract)
// ---------------------------------------------------------------------------

/** Status/progress of one component-owned crawl. Read-only. */
export const getResearchCrawl = internalQuery({
  args: { crawlId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const crawl = await firecrawl.getCrawl(asQueryCtx(ctx), args.crawlId);
    if (crawl === null) return null;
    return {
      crawlId: crawl._id,
      jobId: crawl.jobId,
      url: crawl.url,
      status: crawl.status,
      mode: crawl.mode,
      pageCount: crawl.pageCount,
      completed: crawl.completed,
      total: crawl.total,
      creditsUsed: crawl.creditsUsed,
      unstored: crawl.unstored,
      error: crawl.error,
      finalized: crawl.finalized,
      startedAt: crawl.startedAt,
      completedAt: crawl.completedAt,
    };
  },
});

/** Stored pages of one crawl (URLs + metadata, bounded page size). */
export const listResearchPages = internalQuery({
  args: {
    crawlId: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const page = await firecrawl.listPages(asQueryCtx(ctx), {
      crawlId: args.crawlId,
      paginationOpts: {
        numItems: Math.min(args.paginationOpts.numItems, 10),
        cursor: args.paginationOpts.cursor,
      },
    });
    return {
      ...page,
      page: page.page.map((p) => ({
        pageId: p._id,
        url: p.url,
        title: p.metadata?.["title"],
        statusCode: p.metadata?.["statusCode"],
        truncated: p.truncated,
        scrapedAt: p.scrapedAt,
        hasMarkdown: typeof p.markdown === "string" && p.markdown.length > 0,
      })),
    };
  },
});

/**
 * DEV-ONLY diagnostic reader for the P04 live probe: projects the component's
 * crawl table down to operational fields so the probe can verify crawl state
 * without exposing page bodies to logs. Internal-only — unreachable from
 * clients or HTTP routes. **TODO(P16): remove before public release** (same
 * convention as agentmail.ts `diagnosticInboundState`).
 */
export const diagnosticFirecrawlState = internalAction({
  args: {},
  returns: v.object({
    crawls: v.array(
      v.object({
        crawlId: v.string(),
        url: v.string(),
        status: v.string(),
        mode: v.string(),
        pageCount: v.number(),
        creditsUsed: v.optional(v.number()),
        finalized: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const crawls = await firecrawl.listCrawls(asQueryCtx(ctx), { limit: 20 });
    return {
      crawls: crawls.map((c) => ({
        crawlId: c._id,
        url: c.url,
        status: c.status,
        mode: c.mode,
        pageCount: c.pageCount,
        creditsUsed: c.creditsUsed,
        finalized: c.finalized,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// The budgeted research route (P21 — integrations §G2 gateway contract item 3,
// Firecrawl route items 2/3/5)
//
// `scrapePage` above is the raw primitive: it forwards a paid request and
// reserves nothing. Everything in the pipeline goes through
// `retrieveProspectPage` instead, which is the only path that may spend a
// campaign's page allowance. The sequence is fixed and its order is the whole
// guarantee:
//
//   1. beginFirecrawlOperation — ONE transaction that admits the URL, checks
//      the per-prospect page cap, dedupes the invocation id and reserves the
//      allowance. A refusal at any step rolls the whole transaction back, so
//      a refused call never reaches the provider and never leaves a partial
//      record behind.
//   2. scrapePage — the paid call, only on `decision: "execute"`.
//   3. settleFirecrawlOperation — commit what was billed, release what never
//      left the deployment, and mark uncertain what we cannot tell apart.
//
// `reserved → released` is terminal and `uncertain` deliberately keeps
// capacity blocked; neither is worked around here.
// ---------------------------------------------------------------------------

/** How long a `requested`/`accepted` operation may sit before the sweep
 *  calls its outcome unknown and blocks its allowance until reconciled. */
const PROVIDER_OPERATION_STALE_MS = 10 * 60 * 1000;

/** The page body recorded on a completed operation (no self-reference). */
const vScrapedPageRecord = v.object({
  url: v.string(),
  retrievedAt: v.number(),
  excerpt: v.string(),
  statusCode: v.optional(v.number()),
  truncated: v.boolean(),
});

const vProviderOperationError = v.object({
  code: v.string(),
  message: v.string(),
});

/**
 * Admit a research URL inside a MUTATION: normalize it, then run the same
 * public-host policy `scrapePage` applies, translated into a domain error.
 * Reusing the one policy function matters more than the error shape — a
 * second copy would drift from the first.
 */
function admitResearchUrl(raw: string): string {
  const normalized = normalizeHttpUrl(raw, "url");
  try {
    assertPublicHttpUrl(normalized);
  } catch (error) {
    throw invalid(
      `url is not an admissible research target: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return normalized;
}

/**
 * Reserve a page of the campaign's lifetime research allowance and record
 * the invocation BEFORE the provider is contacted.
 *
 * A repeated `operationKey` returns the recorded result or status and never
 * forwards a second paid request: `completed` replays the stored page,
 * `failed` replays the stored error, and `requested`/`accepted`/`uncertain`
 * surface an explicit in-flight or unknown status. A repeat carrying
 * different arguments is a conflict, not a replay.
 */
export const beginFirecrawlOperation = internalMutation({
  args: {
    missionId: v.id("missions"),
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
    url: v.string(),
  },
  returns: v.union(
    v.object({
      decision: v.literal("execute"),
      providerOperationId: v.id("providerOperations"),
      url: v.string(),
    }),
    v.object({
      decision: v.literal("replay"),
      providerOperationId: v.id("providerOperations"),
      state: vProviderOperationState,
      page: v.optional(vScrapedPageRecord),
      error: v.optional(vProviderOperationError),
    }),
  ),
  handler: async (ctx, args): Promise<BeginFirecrawlOperationResult> => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    if (
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; cannot spend a research page`,
      );
    }
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (campaign === null) {
      throw domainError("NOT_FOUND", "campaign not found for mission");
    }
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (
      prospect === null ||
      prospect.workspaceId !== mission.workspaceId ||
      prospect.campaignId !== mission.campaignId
    ) {
      // Cross-workspace and cross-campaign rows are the same NOT_FOUND —
      // existence never leaks across a scope boundary.
      throw domainError("NOT_FOUND", "prospect not found for this mission");
    }
    // Admission runs FIRST: an inadmissible URL must never reserve.
    const url = admitResearchUrl(args.url);

    const operationKey = `research:${mission.campaignId}:${args.prospectId}:${await sha256Hex(url)}`;
    const requestDigest = await computeResultDigest({
      provider: "firecrawl",
      tool: "scrape",
      arguments: { url },
    });

    const existing = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
        q
          .eq("workspaceId", mission.workspaceId)
          .eq("provider", "firecrawl")
          .eq("operationKey", operationKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestDigest !== requestDigest) {
        throw domainError(
          "CONFLICT",
          "operationKey was already used with different arguments",
        );
      }
      const recorded =
        existing.state === "completed" && existing.resultRef?.kind === "inline"
          ? (existing.resultRef.value as Infer<typeof vScrapedPageRecord>)
          : undefined;
      return {
        decision: "replay" as const,
        providerOperationId: existing._id,
        state: existing.state,
        ...(recorded !== undefined ? { page: recorded } : {}),
        ...(existing.error !== undefined ? { error: existing.error } : {}),
      };
    }

    // §G2 Firecrawl route item 2 — homepage plus at most two other pages.
    // `failed` rows do not count: a page that was never billed must not
    // consume a prospect's share.
    const priorForProspect = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_prospectId_and_state", (q) =>
        q
          .eq("workspaceId", mission.workspaceId)
          .eq("prospectId", args.prospectId),
      )
      .take(32);
    const counted = priorForProspect.filter(
      (row) => row.state !== "failed",
    ).length;
    if (counted >= RESEARCH_PAGES_PER_PROSPECT) {
      throw domainError(
        "CONFLICT",
        `prospect page cap reached (${counted}/${RESEARCH_PAGES_PER_PROSPECT})`,
      );
    }

    // The reservation is taken inside THIS transaction. A CONFLICT here
    // aborts everything above it — the operation row is never written, the
    // cap accounting never moves, and the provider is never contacted.
    const reservation = await ctx.runMutation(internal.usage.reserve, {
      workspaceId: mission.workspaceId,
      scopeKey: `campaign:${mission.campaignId}`,
      metric: "research_pages" as const,
      periodKey: "lifetime",
      limit: researchPageLimit(campaign.leadLimit),
      operationKey,
      quantity: 1,
    });

    const now = Date.now();
    const providerOperationId = await ctx.db.insert("providerOperations", {
      workspaceId: mission.workspaceId,
      provider: "firecrawl" as const,
      operationKey,
      missionId: mission._id,
      requestDigest,
      reservationIds: [reservation.reservationId],
      state: "requested" as const,
      createdAt: now,
      updatedAt: now,
      prospectId: args.prospectId,
      ...(args.runId !== undefined ? { runId: args.runId } : {}),
    });
    return { decision: "execute" as const, providerOperationId, url };
  },
});

/**
 * Settle one provider operation and its reservation together. The caller
 * chooses the settlement because only the caller knows whether the provider
 * was reached; this applies it faithfully and idempotently.
 */
export const settleFirecrawlOperation = internalMutation({
  args: {
    providerOperationId: v.id("providerOperations"),
    settlement: v.union(
      v.literal("commit"),
      v.literal("release"),
      v.literal("markUncertain"),
    ),
    state: vProviderOperationState,
    page: v.optional(vScrapedPageRecord),
    componentRequestRef: v.optional(v.string()),
    error: v.optional(vProviderOperationError),
  },
  returns: v.object({ state: vProviderOperationState, settled: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ state: ProviderOperationState; settled: boolean }> => {
    const row = await ctx.db.get(
      "providerOperations",
      args.providerOperationId,
    );
    if (row === null) {
      throw domainError("NOT_FOUND", "provider operation not found");
    }
    if (row.state === args.state) {
      // Idempotent replay — the reservation already moved with it.
      return { state: row.state, settled: false };
    }
    if (row.state === "completed" || row.state === "failed") {
      throw domainError(
        "CONFLICT",
        `provider operation is ${row.state}; it can no longer be settled`,
      );
    }
    const pageDigest =
      args.page === undefined ? undefined : await computeResultDigest(args.page);
    if (args.settlement === "commit") {
      await ctx.runMutation(internal.usage.commit, {
        workspaceId: row.workspaceId,
        operationKey: row.operationKey,
        ...(args.componentRequestRef !== undefined
          ? { providerReference: args.componentRequestRef }
          : {}),
      });
    } else if (args.settlement === "release") {
      await ctx.runMutation(internal.usage.release, {
        workspaceId: row.workspaceId,
        operationKey: row.operationKey,
      });
    } else {
      await ctx.runMutation(internal.usage.markUncertain, {
        workspaceId: row.workspaceId,
        operationKey: row.operationKey,
      });
    }
    await ctx.db.patch("providerOperations", row._id, {
      state: args.state,
      updatedAt: Date.now(),
      ...(args.page !== undefined
        ? {
            resultRef: { kind: "inline" as const, value: args.page },
            resultDigest: pageDigest,
          }
        : {}),
      ...(args.componentRequestRef !== undefined
        ? { componentRequestRef: args.componentRequestRef }
        : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
    });
    return { state: args.state, settled: true };
  },
});

/**
 * Retrieve ONE page for a prospect, paying for it exactly once.
 *
 * The outcome table, and why each settlement is the honest one:
 *
 *   page returned                 commit   — we were billed. A provider cache
 *                                            hit still commits: this counts
 *                                            OUR operations, which is a
 *                                            separate number from the
 *                                            provider's observed credits.
 *   redirect to a private host    commit   — the fetch happened and was
 *                                            billed; refusing to bill
 *                                            ourselves would understate spend.
 *                                            The page is still refused.
 *   missing API key               release  — the request never left Convex.
 *   transport failure (status 0)  release  — it never reached Firecrawl.
 *   any other provider failure    uncertain— it reached Firecrawl and may
 *                                            have been metered.
 *   unknown throw                 uncertain— same reason: we cannot prove it
 *                                            was not billed.
 *   process death mid-call        (none)   — left `requested`; the sweep
 *                                            below moves it to `uncertain`.
 */
export const retrieveProspectPage = internalAction({
  args: {
    missionId: v.id("missions"),
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
    url: v.string(),
  },
  returns: v.object({
    replayed: v.boolean(),
    state: vProviderOperationState,
    providerOperationId: v.id("providerOperations"),
    page: v.optional(vRetrievedPage),
    error: v.optional(vProviderOperationError),
  }),
  handler: async (ctx, args): Promise<RetrieveProspectPageResult> => {
    const begin = await ctx.runMutation(
      internal.integrations.firecrawl.beginFirecrawlOperation,
      {
        missionId: args.missionId,
        prospectId: args.prospectId,
        ...(args.runId !== undefined ? { runId: args.runId } : {}),
        url: args.url,
      },
    );
    if (begin.decision === "replay") {
      return {
        replayed: true,
        state: begin.state,
        providerOperationId: begin.providerOperationId,
        ...(begin.page !== undefined
          ? {
              page: {
                ...begin.page,
                providerOperationId: begin.providerOperationId,
              },
            }
          : {}),
        ...(begin.error !== undefined ? { error: begin.error } : {}),
      };
    }

    let scraped: ScrapeResult;
    try {
      scraped = await ctx.runAction(
        internal.integrations.firecrawl.scrapePage,
        { url: begin.url },
      );
    } catch (error) {
      const failure = classifyFirecrawlFailure(error);
      await ctx.runMutation(
        internal.integrations.firecrawl.settleFirecrawlOperation,
        {
          providerOperationId: begin.providerOperationId,
          settlement: failure.settlement,
          state: failure.state,
          error: { code: failure.code, message: failure.message },
        },
      );
      return {
        replayed: false,
        state: failure.state,
        providerOperationId: begin.providerOperationId,
        error: { code: failure.code, message: failure.message },
      };
    }

    const retrievedAt = Date.parse(scraped.retrievedAt);
    const page = {
      url: scraped.url,
      // `scrapePage` stamps this itself, so a value outside the calendar
      // window is a defect in this deployment, not untrusted provider data.
      retrievedAt: assertEpochMs(retrievedAt, "retrievedAt"),
      excerpt: scraped.markdownExcerpt,
      ...(scraped.statusCode !== undefined
        ? { statusCode: scraped.statusCode }
        : {}),
      truncated: scraped.markdownTruncated,
    };
    await ctx.runMutation(
      internal.integrations.firecrawl.settleFirecrawlOperation,
      {
        providerOperationId: begin.providerOperationId,
        settlement: "commit" as const,
        state: "completed" as const,
        page,
        componentRequestRef: providerReceipt(scraped),
      },
    );
    return {
      replayed: false,
      state: "completed" as const,
      providerOperationId: begin.providerOperationId,
      page: { ...page, providerOperationId: begin.providerOperationId },
    };
  },
});

type BeginFirecrawlOperationResult =
  | {
      decision: "execute";
      providerOperationId: Id<"providerOperations">;
      url: string;
    }
  | {
      decision: "replay";
      providerOperationId: Id<"providerOperations">;
      state: ProviderOperationState;
      page?: Infer<typeof vScrapedPageRecord>;
      error?: Infer<typeof vProviderOperationError>;
    };

type RetrieveProspectPageResult = {
  replayed: boolean;
  state: ProviderOperationState;
  providerOperationId: Id<"providerOperations">;
  page?: Infer<typeof vRetrievedPage>;
  error?: Infer<typeof vProviderOperationError>;
};

/** The backend receipt for one paid call: the provider's own credit and
 *  cache report, recorded so our operation count and the provider's credit
 *  count stay separately auditable (§G2 item 4). */
function providerReceipt(scraped: ScrapeResult): string {
  return `firecrawl:credits=${scraped.creditsUsed ?? "unknown"};cache=${scraped.cacheState ?? "unknown"}`;
}

/** Post-fetch URL policy messages from `assertPublicHttpUrl`. Reaching one
 *  of these means Firecrawl already fetched and reported a redirect we will
 *  not accept — the call was billed even though the page is refused. */
const POST_FETCH_URL_POLICY = [
  "private/reserved",
  "local hostname not allowed",
  "credential-bearing URLs",
  "URL scheme must be http(s)",
];

function classifyFirecrawlFailure(error: unknown): {
  settlement: "commit" | "release" | "markUncertain";
  state: ProviderOperationState;
  code: string;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error as { data?: unknown }).data
      : undefined;
  const code =
    typeof data === "object" && data !== null && "code" in data
      ? String((data as { code?: unknown }).code)
      : undefined;
  const status =
    typeof data === "object" && data !== null && "status" in data
      ? (data as { status?: unknown }).status
      : undefined;

  if (POST_FETCH_URL_POLICY.some((needle) => message.includes(needle))) {
    return {
      settlement: "commit",
      state: "failed",
      code: "redirect_to_private_host",
      message: message.slice(0, 500),
    };
  }
  if (code === "firecrawl_missing_api_key") {
    return {
      settlement: "release",
      state: "failed",
      code,
      message: "the deployment has no Firecrawl API key configured",
    };
  }
  if (code === "firecrawl_request_failed" && status === 0) {
    return {
      settlement: "release",
      state: "failed",
      code,
      message: message.slice(0, 500),
    };
  }
  if (code === "firecrawl_request_failed") {
    return {
      settlement: "markUncertain",
      state: "uncertain",
      code,
      message: message.slice(0, 500),
    };
  }
  return {
    settlement: "markUncertain",
    state: "uncertain",
    code: "provider_outcome_unknown",
    message: message.slice(0, 500),
  };
}

/**
 * Reconcile operations whose outcome was never recorded — a process death
 * or an aborted caller between the reservation and the settle. They become
 * `uncertain`, which KEEPS the allowance blocked: that is the accounting
 * G2 asks for, not a leak to be tidied away by releasing capacity we cannot
 * prove we still have.
 */
export const sweepStaleFirecrawlOperations = internalMutation({
  args: {},
  returns: v.object({ checked: v.number(), reconciled: v.number() }),
  handler: async (ctx): Promise<{ checked: number; reconciled: number }> => {
    const cutoff = Date.now() - PROVIDER_OPERATION_STALE_MS;
    let checked = 0;
    let reconciled = 0;
    for (const state of ["requested", "accepted"] as const) {
      const stale = await ctx.db
        .query("providerOperations")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", state).lt("updatedAt", cutoff),
        )
        .take(16);
      for (const row of stale) {
        checked += 1;
        // Ask before settling: a nested mutation's throw would abort this
        // whole sweep, so a reservation someone else already settled must
        // not be handed to `markUncertain`.
        const reservation = await ctx.runMutation(
          internal.usage.getByOperationKey,
          { workspaceId: row.workspaceId, operationKey: row.operationKey },
        );
        if (reservation !== null && reservation.state === "reserved") {
          await ctx.runMutation(internal.usage.markUncertain, {
            workspaceId: row.workspaceId,
            operationKey: row.operationKey,
          });
        }
        await ctx.db.patch("providerOperations", row._id, {
          state: "uncertain",
          updatedAt: Date.now(),
          error: {
            code: "provider_outcome_unknown",
            message: "no outcome was recorded before the reconciliation window",
          },
        });
        reconciled += 1;
      }
    }
    return { checked, reconciled };
  },
});
