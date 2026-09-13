// Host-side helper: run one shell command inside a Box and print its output.
// Usage: node dist/boxcmd.js --box <boxId> --cmd "<shell>" [--timeout <sec>]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AsciiBoxClient } from "./ascii/client.js";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(DIST_DIR, "..", "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function envKey(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  for (const raw of readFileSync(join(REPO_ROOT, ".env.local"), "utf8").split("\n")) {
    const t = raw.trim();
    if (t.startsWith(`${name}=`)) return t.slice(name.length + 1).trim();
  }
  throw new Error(`${name} not found`);
}

const boxId = arg("box");
const cmd = arg("cmd");
if (!boxId || !cmd) throw new Error("usage: --box <id> --cmd <shell> [--timeout s]");

const client = new AsciiBoxClient(envKey("ASCII_API_KEY"));
const res = await client.runCommand(boxId, {
  command: cmd,
  timeoutSeconds: Number(arg("timeout") ?? 120),
});
process.stdout.write(JSON.stringify(res, null, 1).slice(0, 8000) + "\n");
