// scripts/p11-worker-drive.mjs — probe driver, not a test file
// (cf. scripts/p11-sign-inbound.mjs, scripts/p10-probe.sh)
/**
 * P11 gate bridge driver: one claim/result/failure cycle against the
 * deployment's worker bridge (`/worker/claim`, `/worker/result`,
 * `/worker/failure`), using a scoped `osw_` credential minted by a fixture
 * seeder (`workerOperations.devSeedSalesMission`/`devSeedFixture`).
 *
 * A claimed request's `workerRequestId`, `generation` and `leaseToken` are
 * persisted to a state file so `result`/`failure` answer the lease that is
 * actually held. `resultDigest` is the backend's own rule —
 * `sha256:` + sha256hex over the canonical (sorted-key, undefined-elided)
 * JSON of the result object — the same bytes `workerBridge.applyResult`
 * recomputes and compares before recording.
 *
 * Usage:
 *   OPENSQUAD_SITE=http://127.0.0.1:3213 \
 *   OPENSQUAD_WORKER_TOKEN=osw_… \
 *   OPENSQUAD_RTGEN=1 \
 *     node scripts/p11-worker-drive.mjs claim
 *     node scripts/p11-worker-drive.mjs result '{"schemaVersion":1,…}'
 *     node scripts/p11-worker-drive.mjs failure worker_crashed safe 'summary'
 *
 * Prints the HTTP status and the (already-sanitized) JSON response; never
 * prints the token.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = process.env.OPENSQUAD_SITE;
const TOKEN = process.env.OPENSQUAD_WORKER_TOKEN;
const RTGEN = Number(process.env.OPENSQUAD_RTGEN ?? "1");
const STATE = join(
  tmpdir(),
  `opensquad-claim-${process.env.OPENSQUAD_GATE ?? "p11"}.json`,
);

if (SITE === undefined || TOKEN === undefined) {
  console.error("OPENSQUAD_SITE and OPENSQUAD_WORKER_TOKEN are required");
  process.exit(2);
}

/** Byte-identical to convex/lib/validators.ts `canonicalJson` (sorted keys,
 *  undefined-elided) — the digest both sides must agree on. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function post(path, body) {
  const response = await fetch(`${SITE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { http: response.status, body: text === "" ? null : JSON.parse(text) };
}

const cmd = process.argv[2];
if (cmd === "claim") {
  const out = await post("/worker/claim", {
    requestId: `p11-claim-${randomUUID().slice(0, 8)}`,
    runtimeGeneration: RTGEN,
    protocolVersion: "p11-gate/1",
  });
  console.log(JSON.stringify(out));
  if (out.body?.claimed) {
    writeFileSync(STATE, JSON.stringify(out.body));
    console.error(
      `claimed ${out.body.operation} ${out.body.workerRequestId} (state: ${STATE})`,
    );
  }
} else if (cmd === "result") {
  const claim = JSON.parse(readFileSync(STATE, "utf8"));
  const result = JSON.parse(process.argv[3]);
  const out = await post("/worker/result", {
    workerRequestId: claim.workerRequestId,
    generation: claim.generation,
    leaseToken: claim.leaseToken,
    runtimeGeneration: RTGEN,
    resultId: `p11-result-${randomUUID().slice(0, 8)}`,
    resultDigest: `sha256:${await sha256Hex(canonicalJson(result))}`,
    result,
  });
  console.log(JSON.stringify(out));
} else if (cmd === "failure") {
  const claim = JSON.parse(readFileSync(STATE, "utf8"));
  const out = await post("/worker/failure", {
    workerRequestId: claim.workerRequestId,
    generation: claim.generation,
    leaseToken: claim.leaseToken,
    runtimeGeneration: RTGEN,
    failureId: `p11-fail-${randomUUID().slice(0, 8)}`,
    code: process.argv[3],
    retrySafety: process.argv[4],
    summary: (process.argv[5] ?? "p11 gate failure").slice(0, 500),
  });
  console.log(JSON.stringify(out));
} else {
  console.error("usage: claim | result <json> | failure <code> <safe|unsafe|unknown> [summary]");
  process.exit(2);
}
