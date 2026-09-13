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
import { components } from "../_generated/api";
import {
  internalAction,
  internalQuery,
} from "../_generated/server";
import type { FunctionReference } from "convex/server";

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
 * residual limitation recorded in plan/evidence/P04.md. Redirect targets are
 * validated the same way when the provider reports them in metadata.
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
  const host = url.hostname.toLowerCase();
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
      v6 === "::1" ||
      v6 === "::" ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("fe80") ||
      v6.startsWith("::ffff:")
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
