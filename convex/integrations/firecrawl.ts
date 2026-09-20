/**
 * The web-research boundary (PLAN §4 "Firecrawl change needed").
 *
 * ONE operation lives here: `scrapeSite` reads a company's website — the home
 * page, plus up to three supporting pages chosen from that home page's own
 * links — and returns bounded markdown. Website analysis asks for four pages,
 * lead research for one. The page count is fixed in code; nothing a caller
 * or a site says can raise it.
 *
 * Three rules hold the boundary:
 *
 *   1. The provider is reached only through the registered
 *      `@firecrawl/firecrawl-convex` component (its signed `/firecrawl/webhook`
 *      stays mounted by the component itself, via `httpPrefix` in
 *      convex.config.ts). The provider's name and its raw error text never
 *      leave this folder — callers get our own typed outcomes.
 *   2. Every URL passes `lib/urlSafety.ts` BEFORE anything is reserved and
 *      before anything is fetched, and the provider-reported final URL passes
 *      it again on the way back.
 *   3. The whole scrape is ONE `withCredits` call: worst case `scrapes: pages`,
 *      settled at the pages really fetched. A provable pre-flight refusal
 *      RETURNS `refunded`; an unknown outcome THROWS, which parks the hold as
 *      `uncertain` (PLAN §6 "Three outcomes, never two").
 *
 * The markdown of a billed scrape is stored in Convex file storage and the
 * operation's `resultRef` points at it, so a replay of the same
 * `operationKey` — the retry of a failed AI half — hands the caller the pages
 * it already paid for instead of buying them again.
 */
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { FunctionReference } from "convex/server";
import type { PaidWork, RefundReason } from "../billing/paidCall";
import { withCredits } from "../billing/withCredits";
import { checkPublicHttpUrl } from "../lib/urlSafety";
import type { SafeUrl } from "../lib/urlSafety";
import {
  boundMarkdown,
  combineSiteMarkdown,
  linksFromMarkdown,
  selectExtraPages,
  SCRAPE_EXTRA_PAGES_MAX,
  SCRAPE_EXTRA_PAGE_MARKDOWN_MAX,
  SCRAPE_HOME_MARKDOWN_MAX,
  SCRAPE_TITLE_MAX,
} from "./firecrawlPages";
import type { ScrapedPage } from "./firecrawlPages";

export type { ScrapedPage } from "./firecrawlPages";

/** Shared component client handle. `FIRECRAWL_API_KEY` /
 * `FIRECRAWL_WEBHOOK_SECRET` are bound to the component's typed env in
 * convex.config.ts and read inside component functions — never through args. */
export const firecrawl = new FirecrawlClient(components.firecrawl);

// The component's ActionCtx type (resolved under convex 1.45.0) expects the
// `(fn, args, options?: {transactionLimits})` ArgsAndOptions signature, while
// the real ctx exposes the single-argument OptionalRestArgs form. The
// component only ever calls runQuery/runMutation/runAction(fn, argsObject)
// (verified in dist/client/index.js), so this adapter drops the unused
// options element; runtime behavior is unchanged.
type ComponentActionCtx = Parameters<typeof firecrawl.scrape>[0];

type PlainQuery = (q: FunctionReference<"query">, args?: unknown) => Promise<unknown>;
type PlainMutation = (m: FunctionReference<"mutation">, args?: unknown) => Promise<unknown>;
type PlainAction = (a: FunctionReference<"action">, args?: unknown) => Promise<unknown>;

/** Rebind the real ctx's runners positionally for the component client's
 *  skewed signature. The casts are the honest statement of verified runtime
 *  behavior — the declared types disagree on rest-tuple shapes, not on
 *  capability. */
function asComponentCtx(ctx: ActionCtx): ComponentActionCtx {
  const adapted = {
    runQuery: ((q, args) =>
      (ctx.runQuery as unknown as PlainQuery)(q, args)) satisfies PlainQuery,
    runMutation: ((m, args) =>
      (ctx.runMutation as unknown as PlainMutation)(m, args)) satisfies PlainMutation,
    runAction: ((a, args) =>
      (ctx.runAction as unknown as PlainAction)(a, args)) satisfies PlainAction,
  };
  return adapted as unknown as ComponentActionCtx;
}

/* ------------------------------------------------------------------ */
/* What a caller asks for, and what it gets back                        */
/* ------------------------------------------------------------------ */

/** The two paid actions that read a website (`lib/limits.ts` prices them). */
export type ScrapeAction = "analyze_website" | "research_lead";

export type ScrapeSiteArgs = {
  orgId: Id<"orgs">;
  /** The site to read. A bare domain is read as `https://`. */
  url: string;
  /** 1 = the home page only; 4 = the home page plus up to three supporting
   *  pages. Fixed by the caller's step, never by user input. */
  pages: 1 | 4;
  action: ScrapeAction;
  /** Stable per-step key. The same key never buys the same pages twice. */
  operationKey: string;
};

/** The pages one scrape produced, bounded and ready to be read or prompted. */
export type ScrapedSite = {
  /** At least one page. Ordered: home page first, then supporting pages. */
  pages: ScrapedPage[];
  /** Every page in one document, under the site character budget. */
  combinedMarkdown: string;
};

/**
 * What the caller must handle. Each member says what to DO, not what the
 * provider said:
 *
 *   scraped     — pages in hand (`replayed` means they were already paid for).
 *   empty       — we reached the site and there was nothing readable on it.
 *   refused     — we never read it. `reason` picks the copy; none of the
 *                 reasons names a provider.
 *   uncertain   — the request left us and the hold stays until it reconciles.
 *   unavailable — this operation was billed earlier and its pages are not
 *                 readable now: the stored markdown is gone, or that earlier
 *                 run found nothing on the site. Retry under a FRESH
 *                 operation key, or fall back to the manual path.
 */
export type ScrapeSiteOutcome =
  | { kind: "scraped"; replayed: boolean; site: ScrapedSite }
  | { kind: "empty" }
  | { kind: "refused"; reason: RefundReason }
  | { kind: "uncertain" }
  | { kind: "unavailable" };

/* ------------------------------------------------------------------ */
/* One page from the provider                                           */
/* ------------------------------------------------------------------ */

/** One provider answer, already re-admitted by the URL policy. */
type ProviderDocument = {
  /** `null` when the provider reported a final URL we will not accept. */
  finalUrl: SafeUrl | null;
  markdown: string;
  title?: string;
  statusCode?: number;
  /** The provider's own credit report. `undefined` means "it did not say". */
  creditsUsed?: number;
  cacheState?: string;
  links: string[];
};

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Fetch one page as markdown plus its outbound links. Throws whatever the
 *  component throws; the classifier below is the only thing that reads it. */
async function fetchPage(ctx: ActionCtx, target: SafeUrl): Promise<ProviderDocument> {
  const doc = await firecrawl.scrape(asComponentCtx(ctx), target.url, {
    formats: ["markdown", "links"],
    onlyMainContent: true,
  });
  const metadata = doc.metadata ?? {};
  // The provider may have followed a redirect. Whatever it reports as the
  // final URL faces the same policy the request did.
  const reported = textField(metadata.url) ?? textField(metadata.sourceURL);
  const admitted =
    reported === undefined ? { ok: true as const, url: target } : checkPublicHttpUrl(reported);
  const title = textField(metadata.title);
  const statusCode = numberField(metadata.statusCode);
  const creditsUsed = numberField(metadata.creditsUsed);
  const cacheState = textField(metadata.cacheState);
  return {
    finalUrl: admitted.ok ? admitted.url : null,
    markdown: typeof doc.markdown === "string" ? doc.markdown : "",
    ...(title !== undefined
      ? { title: boundMarkdown(title, SCRAPE_TITLE_MAX).text }
      : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(creditsUsed !== undefined ? { creditsUsed } : {}),
    ...(cacheState !== undefined ? { cacheState } : {}),
    links: Array.isArray(doc.links)
      ? doc.links.filter((link): link is string => typeof link === "string")
      : [],
  };
}

/** The page a caller may read, or `null` when there is nothing usable on it:
 *  a refused final URL, an error status, or no main content at all. */
function toScrapedPage(doc: ProviderDocument, limit: number): ScrapedPage | null {
  if (doc.finalUrl === null) {
    return null;
  }
  if (doc.statusCode !== undefined && doc.statusCode >= 400) {
    return null;
  }
  const bounded = boundMarkdown(doc.markdown, limit);
  if (bounded.text.length === 0) {
    return null;
  }
  return {
    url: doc.finalUrl.url,
    ...(doc.title !== undefined ? { title: doc.title } : {}),
    markdown: bounded.text,
    truncated: bounded.truncated,
  };
}

/** Provider units this page consumed. A reported zero is a cache hit and is
 *  released; silence means it charged us the usual one page. */
function chargeOf(doc: ProviderDocument): number {
  return doc.creditsUsed === 0 ? 0 : 1;
}

/** The provider's own report, kept server-side for reconciliation (the
 *  settle path wraps it with our action and credits). */
function providerReceipt(docs: readonly ProviderDocument[]): string {
  const cache = docs.map((doc) => doc.cacheState ?? "unknown").join(",");
  return `pages=${docs.length};cache=${cache}`;
}

/* ------------------------------------------------------------------ */
/* Failure classification — the difference between a refund and a hold  */
/* ------------------------------------------------------------------ */

type ProviderFailure =
  /** Provably not charged, or charged nothing. The money goes back. */
  | { kind: "refund"; reason: RefundReason }
  /** It may have been metered. The hold stays until something proves otherwise. */
  | { kind: "uncertain" };

const UNCERTAIN: ProviderFailure = { kind: "uncertain" };

function errorData(error: unknown): { code?: unknown; status?: unknown } {
  return typeof error === "object" && error !== null && "data" in error
    ? ((error as { data?: { code?: unknown; status?: unknown } }).data ?? {})
    : {};
}

/**
 * Read one provider failure as money.
 *
 * The component's own vocabulary (`dist/component/api.ts`): a missing key
 * throws before any request, a transport failure reports status 0, and every
 * HTTP failure arrives as `{ code: "firecrawl_request_failed", status }` with
 * 408/425/429/5xx already retried three times behind it.
 */
function classifyProviderFailure(error: unknown): ProviderFailure {
  const { code, status } = errorData(error);
  if (code === "firecrawl_missing_api_key") {
    // The request never left the deployment.
    return { kind: "refund", reason: "unauthorized" };
  }
  if (code !== "firecrawl_request_failed" || typeof status !== "number") {
    return UNCERTAIN;
  }
  if (status === 0) {
    // Never reached the provider: DNS, TLS, or a dead socket.
    return { kind: "refund", reason: "unknown" };
  }
  if (status === 200) {
    // The provider answered and declined the page — a blocked site, a target
    // it would not render. It reports those as unbilled.
    return { kind: "refund", reason: "provider_charged_nothing" };
  }
  if (status === 401 || status === 403) {
    return { kind: "refund", reason: "unauthorized" };
  }
  if (status === 402) {
    // Our platform account is out of provider credit — capacity, for everyone.
    return { kind: "refund", reason: "platform_capacity" };
  }
  if (status === 429) {
    return { kind: "refund", reason: "rate_limited" };
  }
  if (status === 400 || status === 404 || status === 422) {
    return { kind: "refund", reason: "validation" };
  }
  // 408/5xx and anything unrecognised: it reached the provider and may have
  // been metered.
  return UNCERTAIN;
}

/* ------------------------------------------------------------------ */
/* Stored markdown — what a replayed operation hands back               */
/* ------------------------------------------------------------------ */

/**
 * Keep the bounded markdown where the operation row can point at it.
 *
 * Convex file storage, not a new table and not the operation document: the
 * `evidence` table belongs to leads, the org's own website has no home
 * of its own until T20 writes the profile it produces, and `resultRef` is
 * documented as a short pointer — which is exactly what a storage id is. The
 * blob holds only what this function already returns to the caller.
 */
async function storeSite(ctx: ActionCtx, site: ScrapedSite): Promise<string> {
  const blob = new Blob([JSON.stringify(site)], { type: "application/json" });
  return await ctx.storage.store(blob);
}

function isScrapedSite(value: unknown): value is ScrapedSite {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { pages?: unknown; combinedMarkdown?: unknown };
  return (
    Array.isArray(candidate.pages) &&
    candidate.pages.length > 0 &&
    typeof candidate.combinedMarkdown === "string"
  );
}

/** Read back what a billed operation stored, or `null` when it is gone. */
async function readStoredSite(
  ctx: ActionCtx,
  resultRef: string | null,
): Promise<ScrapedSite | null> {
  if (resultRef === null) {
    return null;
  }
  try {
    const blob = await ctx.storage.get(resultRef as Id<"_storage">);
    if (blob === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(await blob.text());
    return isScrapedSite(parsed) ? parsed : null;
  } catch {
    // A malformed id or an unreadable blob is the same answer as a missing
    // one: we cannot hand back pages we no longer have.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The one operation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Read a website and return bounded markdown, paying for it exactly once.
 *
 * Call it from an internal action that an authenticated mutation scheduled —
 * never from a public function, and never with a URL a user typed straight
 * into a request (`analyze_website` passes the stored website, `research_lead`
 * the stored company domain).
 */
export async function scrapeSite(
  ctx: ActionCtx,
  args: ScrapeSiteArgs,
): Promise<ScrapeSiteOutcome> {
  // Admission first, and outside the money entirely: a URL we will not fetch
  // must never reserve, never reach the provider and never leave a record.
  const admitted = checkPublicHttpUrl(args.url);
  if (!admitted.ok) {
    return { kind: "refused", reason: "validation" };
  }
  const home = admitted.url;

  const outcome = await withCredits<ScrapedSite | null>(
    ctx,
    {
      orgId: args.orgId,
      action: args.action,
      operationKey: args.operationKey,
      worstCaseProviderUnits: { scrapes: args.pages },
    },
    async (): Promise<PaidWork<ScrapedSite | null>> => {
      let first: ProviderDocument;
      try {
        first = await fetchPage(ctx, home);
      } catch (error) {
        const failure = classifyProviderFailure(error);
        if (failure.kind === "refund") {
          return { outcome: "refunded", reason: failure.reason };
        }
        // Unknown outcome: let it out, so the hold is parked `uncertain`.
        throw error;
      }

      const fetched: ProviderDocument[] = [first];
      const pages: ScrapedPage[] = [];
      let charged = chargeOf(first);
      const homePage = toScrapedPage(first, SCRAPE_HOME_MARKDOWN_MAX);
      if (homePage !== null) {
        pages.push(homePage);
      }

      // Supporting pages come from the home page's OWN links — never from a
      // discovery endpoint, and never more than the fixed count.
      if (homePage !== null && args.pages > 1) {
        const links =
          first.links.length > 0 ? first.links : linksFromMarkdown(first.markdown);
        const extras = selectExtraPages(
          home,
          links,
          Math.min(SCRAPE_EXTRA_PAGES_MAX, args.pages - 1),
        );
        for (const extra of extras) {
          try {
            const doc = await fetchPage(ctx, extra);
            fetched.push(doc);
            charged += chargeOf(doc);
            const page = toScrapedPage(doc, SCRAPE_EXTRA_PAGE_MARKDOWN_MAX);
            if (page !== null) {
              pages.push(page);
            }
          } catch (error) {
            // One supporting page is never fatal — the home page is already
            // paid for and readable. An unknown failure still counts against
            // the reservation: we cannot prove it was not metered.
            if (classifyProviderFailure(error).kind !== "refund") {
              charged += 1;
            }
          }
        }
      }

      const receipt = providerReceipt(fetched);
      if (pages.length === 0) {
        // We reached the site and got nothing readable. If it cost nothing,
        // it is a refund; if it cost something, we say so.
        return charged === 0
          ? { outcome: "refunded", reason: "provider_charged_nothing" }
          : {
              outcome: "billed",
              result: null,
              actualUnits: { scrapes: charged },
              providerReference: receipt,
            };
      }
      const site: ScrapedSite = {
        pages,
        combinedMarkdown: combineSiteMarkdown(pages),
      };
      return {
        outcome: "billed",
        result: site,
        actualUnits: { scrapes: charged },
        resultRef: await storeSite(ctx, site),
        providerReference: receipt,
      };
    },
  );

  if (outcome.kind === "uncertain") {
    return { kind: "uncertain" };
  }
  if (outcome.kind === "refunded") {
    // A provider that answered and charged nothing did READ the site; every
    // other refusal means we never got to.
    return outcome.reason === "provider_charged_nothing"
      ? { kind: "empty" }
      : { kind: "refused", reason: outcome.reason };
  }
  if (outcome.replayed) {
    const stored = await readStoredSite(ctx, outcome.resultRef);
    return stored === null
      ? { kind: "unavailable" }
      : { kind: "scraped", replayed: true, site: stored };
  }
  return outcome.result === null
    ? { kind: "empty" }
    : { kind: "scraped", replayed: false, site: outcome.result };
}

/* ------------------------------------------------------------------ */
/* Operational surfaces                                                 */
/* ------------------------------------------------------------------ */

/**
 * DEV-ONLY live probe: run one real scrape and report SIZES, not content, so
 * the integrator can verify the provider route and the refusal cases without
 * putting page bodies in a log. Internal-only — unreachable from clients and
 * from HTTP. **TODO(T50): remove before public release** (same convention as
 * agentmail.ts `diagnosticInboundState`).
 */
export const diagnosticScrapeSite = internalAction({
  args: {
    orgId: v.id("orgs"),
    url: v.string(),
    pages: v.union(v.literal(1), v.literal(4)),
    action: v.union(v.literal("analyze_website"), v.literal("research_lead")),
    operationKey: v.string(),
  },
  returns: v.object({
    kind: v.string(),
    reason: v.optional(v.string()),
    replayed: v.optional(v.boolean()),
    combinedCharacters: v.optional(v.number()),
    pages: v.array(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        characters: v.number(),
        truncated: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const outcome = await scrapeSite(ctx, {
      orgId: args.orgId,
      url: args.url,
      pages: args.pages,
      action: args.action,
      operationKey: args.operationKey,
    });
    if (outcome.kind !== "scraped") {
      return {
        kind: outcome.kind,
        ...(outcome.kind === "refused" ? { reason: outcome.reason } : {}),
        pages: [],
      };
    }
    return {
      kind: outcome.kind,
      replayed: outcome.replayed,
      combinedCharacters: outcome.site.combinedMarkdown.length,
      pages: outcome.site.pages.map((page) => ({
        url: page.url,
        ...(page.title !== undefined ? { title: page.title } : {}),
        characters: page.markdown.length,
        truncated: page.truncated,
      })),
    };
  },
});
