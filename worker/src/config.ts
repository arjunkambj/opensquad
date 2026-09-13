// Worker configuration — reads the four OPENSQUAD_* provisioning names from
// `worker/.env.example` plus local overrides used by the spike.

export const WORKER_VERSION = "0.1.0";

export type WorkerConfig = {
  readonly bridgeUrl: string;
  readonly runtimeId: string;
  readonly runtimeGeneration: number;
  readonly workerToken: string;
  readonly workerVersion: string;
  /** Codex binary to spawn; absolute path inside the pinned image. */
  readonly codexBin: string;
  /** Per-workspace job directory owned by the service account. */
  readonly workDir: string;
};

export type ConfigError = { readonly missing: readonly string[] };

function required(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: WorkerConfig } | { ok: false; error: ConfigError } {
  const bridgeUrl = required(env, "OPENSQUAD_BRIDGE_URL");
  const runtimeId = required(env, "OPENSQUAD_RUNTIME_ID");
  const generationRaw = required(env, "OPENSQUAD_RUNTIME_GENERATION");
  const workerToken = required(env, "OPENSQUAD_WORKER_TOKEN");
  const missing = [
    ...(bridgeUrl === undefined ? ["OPENSQUAD_BRIDGE_URL"] : []),
    ...(runtimeId === undefined ? ["OPENSQUAD_RUNTIME_ID"] : []),
    ...(generationRaw === undefined ? ["OPENSQUAD_RUNTIME_GENERATION"] : []),
    ...(workerToken === undefined ? ["OPENSQUAD_WORKER_TOKEN"] : []),
  ];
  if (missing.length > 0) {
    return { ok: false, error: { missing } };
  }
  const runtimeGeneration = Number(generationRaw);
  if (!/^\d+$/.test(generationRaw ?? "") || !Number.isSafeInteger(runtimeGeneration) || runtimeGeneration < 1) {
    return { ok: false, error: { missing: ["OPENSQUAD_RUNTIME_GENERATION (integer)"] } };
  }
  return {
    ok: true,
    config: {
      bridgeUrl: bridgeUrl as string,
      runtimeId: runtimeId as string,
      runtimeGeneration,
      workerToken: workerToken as string,
      workerVersion: WORKER_VERSION,
      codexBin: env["OPENSQUAD_CODEX_BIN"] ?? "codex",
      workDir:
        env["OPENSQUAD_WORK_DIR"] ?? `${env["HOME"] ?? "/tmp"}/opensquad-work`,
    },
  };
}
