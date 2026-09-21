/**
 * What a site scrape reads, and how much of it we keep.
 *
 * Pure and typed: no provider, no ctx, no network. Two jobs live here because
 * both are policy rather than transport — WHICH extra pages a home page earns
 * (scored in plain code, never by asking a model or a discovery endpoint) and
 * HOW MUCH markdown leaves this boundary (character budgets, so a 400 KB page
 * can never become a prompt).
 *
 * The page count is fixed by the caller's `pages: 1 | 4` and by
 * `SCRAPE_EXTRA_PAGES_MAX` here. Nothing a site says can raise it.
 */
import { checkPublicHttpUrl, isSameOrigin } from "../lib/urlSafety";
import type { SafeUrl } from "../lib/urlSafety";

/** Markdown kept from the home page — the one page every scrape fetches. */
export const SCRAPE_HOME_MARKDOWN_MAX = 10_000;

/** Markdown kept from each supporting page. Smaller: they are context. */
export const SCRAPE_EXTRA_PAGE_MARKDOWN_MAX = 6_000;

/** Ceiling on the combined document handed to the caller (home + extras). */
export const SCRAPE_SITE_MARKDOWN_MAX = 30_000;

/** Longest page title kept. Titles are shown, so they stay short. */
export const SCRAPE_TITLE_MAX = 200;

/** Supporting pages a `pages: 4` scrape may fetch beyond the home page. */
export const SCRAPE_EXTRA_PAGES_MAX = 3;

/** Links from the home page the scorer will look at, in document order. */
export const SCRAPE_LINK_SCAN_MAX = 300;

/** One page as it leaves this boundary: bounded markdown, never raw HTML. */
export type ScrapedPage = {
  /** The final URL, re-admitted by the URL policy after the fetch. */
  url: string;
  title?: string;
  markdown: string;
  /** True when the page's markdown was cut to fit its budget. */
  truncated: boolean;
};

/**
 * Cut `markdown` to `limit` characters, preferring the last line break in the
 * final fifth of the budget so a cut lands between paragraphs rather than
 * mid-sentence.
 */
export function boundMarkdown(
  markdown: string,
  limit: number,
): { text: string; truncated: boolean } {
  const normalized = markdown.trim();
  if (normalized.length <= limit) {
    return { text: normalized, truncated: false };
  }
  const head = normalized.slice(0, limit);
  const lastBreak = head.lastIndexOf("\n");
  const text = lastBreak > limit * 0.8 ? head.slice(0, lastBreak) : head;
  return { text: text.trimEnd(), truncated: true };
}

/**
 * One document for the caller: every page in order, each under its own
 * heading with its source URL, and the whole thing under the site budget.
 */
export function combineSiteMarkdown(pages: readonly ScrapedPage[]): string {
  const sections = pages.map((page) => {
    const heading = page.title === undefined ? page.url : page.title;
    return `# ${heading}\n\nSource: ${page.url}\n\n${page.markdown}`;
  });
  return boundMarkdown(sections.join("\n\n---\n\n"), SCRAPE_SITE_MARKDOWN_MAX)
    .text;
}

/**
 * What a page is worth to a company profile, highest first. Scored on the
 * path's own segments: a marketing site puts its offer, its proof and its
 * story on predictable paths, and guessing them in plain code costs nothing
 * and stays explainable.
 */
const PATH_SCORES: readonly { score: number; segments: readonly string[] }[] = [
  { score: 100, segments: ["pricing", "plans", "price", "pricing-plans"] },
  {
    score: 90,
    segments: [
      "customers",
      "case-studies",
      "case-study",
      "testimonials",
      "success-stories",
      "clients",
    ],
  },
  {
    score: 80,
    segments: ["about", "about-us", "company", "who-we-are", "our-story"],
  },
  {
    score: 70,
    segments: [
      "product",
      "products",
      "platform",
      "solutions",
      "features",
      "capabilities",
      "services",
      "what-we-do",
    ],
  },
  {
    score: 50,
    segments: ["how-it-works", "use-cases", "industries", "integrations"],
  },
  { score: 30, segments: ["contact", "contact-us", "faq"] },
];

/** Paths that are never worth a paid page, whatever else they score. */
const EXCLUDED_SEGMENTS: readonly string[] = [
  "blog",
  "news",
  "press",
  "careers",
  "jobs",
  "legal",
  "privacy",
  "terms",
  "cookies",
  "security",
  "status",
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "account",
  "cart",
  "checkout",
  "docs",
  "documentation",
  "help",
  "support",
  "community",
  "events",
  "webinars",
  "podcast",
  "tag",
  "tags",
  "category",
  "author",
  "search",
];

/** Anything that is a file rather than a page. */
const ASSET_EXTENSION =
  /\.(?:pdf|png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|txt|zip|gz|dmg|exe|mp[34]|mov|woff2?|ttf|eot)$/;

/** Markdown inline links: `[text](href)` and `[text](<href>)`. The fallback
 *  when the provider returns no link list of its own. */
const MARKDOWN_LINK = /\]\(\s*<?([^)\s<>]+)>?/g;

/** Strip a page extension so `/about.html` scores like `/about`. */
function normalizeSegment(segment: string): string {
  return segment.replace(/\.(?:html?|php|aspx?)$/, "").toLowerCase();
}

function pathSegments(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(normalizeSegment);
}

/** What this path is worth, or 0 when it is not worth a paid fetch. */
function scorePath(path: string): number {
  if (ASSET_EXTENSION.test(path.toLowerCase())) {
    return 0;
  }
  const segments = pathSegments(path);
  if (segments.length === 0 || segments.length > 3) {
    // The home page itself, or a page buried deep enough to be an article.
    return 0;
  }
  if (segments.some((segment) => EXCLUDED_SEGMENTS.includes(segment))) {
    return 0;
  }
  const matched = PATH_SCORES.find((entry) =>
    segments.some((segment) => entry.segments.includes(segment)),
  );
  if (matched === undefined) {
    return 0;
  }
  // A shallower path is the more canonical page of the same kind.
  return matched.score - (segments.length - 1) * 5;
}

/** One key for the spellings of a page that would cost the same fetch. */
function dedupeKey(url: SafeUrl): string {
  return `${url.origin}${url.path.replace(/\/+$/, "")}`.toLowerCase();
}

/** The hrefs a markdown document links to, in document order. */
export function linksFromMarkdown(markdown: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const href = match[1];
    if (href !== undefined) {
      links.push(href);
    }
  }
  return links;
}

/**
 * Up to `limit` supporting pages, chosen from the home page's OWN links.
 *
 * Same-origin is compared on the normalised origin, so neither a trailing
 * dot, a capitalised host nor an explicit `:443` can smuggle in another site.
 * The result is deterministic — score, then depth, then the URL itself — so
 * the same home page always costs the same pages.
 */
export function selectExtraPages(
  home: SafeUrl,
  links: readonly string[],
  limit: number,
): SafeUrl[] {
  const ranked = new Map<string, { url: SafeUrl; score: number }>();
  const homeKey = dedupeKey(home);
  for (const href of links.slice(0, SCRAPE_LINK_SCAN_MAX)) {
    let absolute: string;
    try {
      absolute = new URL(href, home.url).toString();
    } catch {
      continue;
    }
    const admitted = checkPublicHttpUrl(absolute);
    if (!admitted.ok || !isSameOrigin(admitted.url, home)) {
      continue;
    }
    // `/pricing`, `/pricing/` and `/PRICING` are one page as far as a paid
    // fetch is concerned; the first spelling the page links wins.
    const key = dedupeKey(admitted.url);
    if (key === homeKey || ranked.has(key)) {
      continue;
    }
    const score = scorePath(admitted.url.path);
    if (score > 0) {
      ranked.set(key, { url: admitted.url, score });
    }
  }
  return [...ranked.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.url.path.length - b.url.path.length ||
        a.url.url.localeCompare(b.url.url),
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.url);
}
