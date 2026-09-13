// Host-side finisher for the P03 live gate on box bx_a879jdvq: the in-Box
// "gate" phase already completed (managed login + one bounded turn). This
// runs the remaining leg: pause(stop→archived) → resume → upload current
// bundle → detached `boxprobe --phase post-resume` (login survival +
// thread/resume + tiny turn) → poll its phase status → delete the box.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AsciiBoxClient } from "./ascii/client.js";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(DIST_DIR, "..", "..");

function envKey(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  for (const raw of readFileSync(join(REPO_ROOT, ".env.local"), "utf8").split("\n")) {
    const t = raw.trim();
    if (t.startsWith(`${name}=`)) return t.slice(name.length + 1).trim();
  }
  throw new Error(`${name} not found`);
}

const BOX = "bx_a879jdvq";
const GATE_DIR = "/home/user/opensquad-gate";
const BUNDLE = `${GATE_DIR}/bundle`;
const CODEX_BIN = "/usr/local/bin/codex";
const client = new AsciiBoxClient(envKey("ASCII_API_KEY"));

const line = (kind: string, data: Record<string, unknown> = {}) =>
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function info() {
  const r = await client.inspectBox(BOX);
  if (!r.ok) throw new Error(`get failed: ${JSON.stringify(r.error)}`);
  return r.value;
}
async function waitState(want: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const b = await info();
    const rec = b as unknown as Record<string, unknown>;
    const inner = (rec["box"] ?? rec) as Record<string, unknown>;
    const state = String(inner["state"] ?? "");
    line("poll", { state });
    if (want.includes(state)) return b;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${want.join("/")} (last=${state})`);
    await sleep(8000);
  }
}
async function run(command: string, timeoutSeconds = 120) {
  const r = await client.runCommand(BOX, { command, timeoutSeconds });
  if (!r.ok) throw new Error(`cmd failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

// 1. pause (stop → archived)
line("stopping");
let stop = await client.stopBox(BOX, { force: false });
if (!stop.ok) line("stopErr", { err: String(stop.error?.message ?? stop.error) });
await waitState(["archived"], 4 * 60_000);
line("archived");

// 2. resume
let res = await client.resumeBox(BOX, { ttlSeconds: 3600 });
if (!res.ok) line("resumeErr", { err: String(res.error?.message ?? res.error) });
await waitState(["ready", "idle"], 4 * 60_000);
line("resumed");

// 3. upload current bundle (post-resume probe writes gate-status-post-resume.json)
await run(`mkdir -p "${BUNDLE}/codex"`);
for (const [local, remote] of [
  ["boxprobe.js", "boxprobe.js"],
  ["envcheck.js", "envcheck.js"],
  ["codex/appserver.js", "codex/appserver.js"],
  ["codex/methods.js", "codex/methods.js"],
] as const) {
  const w = await client.writeFile(BOX, `${BUNDLE}/${remote}`, readFileSync(join(DIST_DIR, local), "utf8"), "utf8");
  if (!w.ok) throw new Error(`upload ${remote}: ${JSON.stringify(w.error)}`);
}
await client.writeFile(BOX, `${BUNDLE}/package.json`, JSON.stringify({ type: "module" }), "utf8");
line("bundleUploaded");

// 4. detached post-resume probe
const post = await client.runCommand(BOX, {
  command: `CODEX_HOME="${GATE_DIR}/codex-home" node "${BUNDLE}/boxprobe.js" --phase post-resume --gate-dir "${GATE_DIR}" --codex-bin "${CODEX_BIN}"`,
  detached: true,
});
if (!post.ok) throw new Error(`post-resume start: ${JSON.stringify(post.error)}`);
line("postResumeStarted", post.value as unknown as Record<string, unknown>);

// 5. poll phase status file
const deadline = Date.now() + 10 * 60_000;
let final: Record<string, unknown> | undefined;
for (;;) {
  const r = await run(`cat "${GATE_DIR}/gate-status-post-resume.json" 2>/dev/null || echo MISSING`);
  const out = String((r as unknown as Record<string, unknown>)["stdout"] ?? "").trim();
  if (out !== "MISSING" && out.length > 2) {
    try {
      final = JSON.parse(out) as Record<string, unknown>;
      line("postStatus", { stage: final["stage"], done: final["done"] });
      if (final["done"] === true) break;
    } catch { /* partial write */ }
  }
  if (Date.now() > deadline) { line("postTimeout"); break; }
  await sleep(8000);
}
line("postFinal", final ?? {});

// 6. delete the box
const del = await client.deleteBox(BOX);
line("delete", del.ok ? { ok: true } : { err: String(del.error?.message ?? del.error) });
line("finishDone");
