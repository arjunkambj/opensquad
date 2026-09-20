/**
 * Which URLs the product is allowed to fetch at all (PLAN §6 "Closing the
 * ways in").
 *
 * Pure and typed: no network, no database, no provider. It answers one
 * question — may we hand this string to a page fetcher? — and it answers it
 * with a reason, so the call site can refuse BEFORE any reservation and
 * before any provider call, and map every reason to the same neutral copy
 * ("We couldn't read that website").
 *
 * The policy, deliberately narrow:
 *   - `http`/`https` only, on the default ports.
 *   - a real registrable domain name, never an IP literal in any encoding.
 *   - no `localhost`, `.local`, `.internal`, `.lan`-style names.
 *   - no credentials in the URL, no overlong input.
 *
 * Note what this is NOT: the fetch happens provider-side, so a hostname that
 * resolves to a private address at fetch time is outside what any code here
 * can see. This is our fetch POLICY; the provider-reported final URL is
 * checked again on the way back, which is why `checkPublicHttpUrl` is called
 * on both sides of a scrape.
 */

/** Longest input accepted. Anything longer is refused unparsed. */
export const URL_MAX_LENGTH = 2048;

/**
 * Why a URL was refused. Every member is a refusal the caller turns into the
 * same user-facing sentence; the distinction is for operators and logs.
 */
export const URL_REJECTION_REASONS = [
  "too_long",
  "malformed",
  "scheme",
  "credentials",
  "port",
  "ip_literal",
  "private_host",
  "local_hostname",
  "not_a_domain",
] as const;

export type UrlRejectionReason = (typeof URL_REJECTION_REASONS)[number];

/** An admitted URL, normalised to origin + path. */
export type SafeUrl = {
  /** `origin` + `path`. Query and fragment are dropped, host is lower-case. */
  readonly url: string;
  /** Scheme + host + non-default port. The same-origin comparison key. */
  readonly origin: string;
  readonly hostname: string;
  readonly path: string;
};

export type UrlSafetyResult =
  | { readonly ok: true; readonly url: SafeUrl }
  | { readonly ok: false; readonly reason: UrlRejectionReason };

/** Hostnames and suffixes that never name a public site. */
const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".private",
  ".test",
  ".example",
  ".invalid",
] as const;

const LOCAL_HOSTS = ["localhost", "local", "home", "corp", "lan"] as const;

const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A label of a DNS name: letters, digits and inner hyphens, at most 63. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A public suffix is alphabetic, or punycode. Never digits, never hex. */
const DNS_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

/** Anything that already carries a scheme — `https:`, `file:`, `javascript:`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Is this dotted quad one we must never fetch? Loopback, the RFC 1918 ranges,
 * link-local, CGNAT, "this network" and everything multicast or reserved.
 * Only the REASON depends on it — every IPv4 literal is refused either way.
 */
function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (a === undefined || b === undefined) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** The dotted-quad octets, or `null` when this host is not one. */
function ipv4Octets(host: string): number[] | null {
  const match = DOTTED_QUAD.exec(host);
  if (match === null) {
    return null;
  }
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function reject(reason: UrlRejectionReason): UrlSafetyResult {
  return { ok: false, reason };
}

/**
 * Admit `raw` as a public http(s) page address, or say why not.
 *
 * Input without a scheme is read as `https://` — a stored company domain
 * ("acme.com") is the common case, and guessing `https` is the only guess
 * that cannot widen the policy. An explicit non-http(s) scheme is always
 * refused, so `file:///etc/passwd` and `javascript:` never become a fetch.
 *
 * IP literals are refused in EVERY encoding: the URL parser folds decimal,
 * hex and octal forms into a dotted quad, and the "must be a registrable
 * domain" rule below refuses anything it leaves behind (a bare number, a
 * `0x…` label, a bracketed IPv6 address).
 */
export function checkPublicHttpUrl(raw: string): UrlSafetyResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return reject("malformed");
  }
  if (trimmed.length > URL_MAX_LENGTH) {
    return reject("too_long");
  }

  let parsed: URL;
  try {
    parsed = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return reject("malformed");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return reject("scheme");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return reject("credentials");
  }

  // The host is judged before the port, so `localhost:3000` is reported as
  // the local name it is rather than as an odd port.
  // A trailing DNS root dot does not make a local hostname public.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) {
    return reject("malformed");
  }
  // Bracketed IPv6, in any form the parser accepted.
  if (host.includes(":") || host.startsWith("[")) {
    return reject("ip_literal");
  }
  const octets = ipv4Octets(host);
  if (octets !== null) {
    return reject(isPrivateIpv4(octets) ? "private_host" : "ip_literal");
  }
  if (
    (LOCAL_HOSTS as readonly string[]).includes(host) ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return reject("local_hostname");
  }

  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => DNS_LABEL.test(label))) {
    // A single label is an intranet name; a malformed label is not a domain.
    // A bare number or `0x…` host lands here too, and is an IP literal in
    // disguise rather than a name.
    return reject(/^(?:\d+|0x[0-9a-f]+)$/.test(host) ? "ip_literal" : "not_a_domain");
  }
  const tld = labels[labels.length - 1] ?? "";
  if (!DNS_TLD.test(tld)) {
    return reject(/^\d+$/.test(tld) ? "ip_literal" : "not_a_domain");
  }

  // The parser drops a default port, so anything left is explicit. Only the
  // two web ports are allowed — an odd port is how an internal service is
  // usually reached.
  if (parsed.port !== "" && parsed.port !== "80" && parsed.port !== "443") {
    return reject("port");
  }

  const port = parsed.port === "" ? "" : `:${parsed.port}`;
  const origin = `${parsed.protocol}//${host}${port}`;
  // Query and fragment are dropped: the pages we fetch are a home page and a
  // handful of links chosen from it, and dropping them makes two spellings of
  // the same page one page.
  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  return { ok: true, url: { url: `${origin}${path}`, origin, hostname: host, path } };
}

/** Same site, compared on the NORMALISED origin — never on raw strings. */
export function isSameOrigin(a: SafeUrl, b: SafeUrl): boolean {
  return a.origin === b.origin;
}
