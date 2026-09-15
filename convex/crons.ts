// Convex scheduled jobs.
//
// The worker-bridge sweep is the only cron for now: leases expire in 60 s so
// a 1-minute cadence bounds how long a dead worker leaves a workspace slot
// marked `uncertain` before the interrupt_turn confirmation can release it.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "worker-lease-sweep",
  { minutes: 1 },
  internal.workerOperations.sweepExpiredLeases,
  {},
);

// Belt for the send boundary: per-attempt sweeps and window wakes are
// scheduled transactionally at commit time, and this sweep re-drives any
// `requesting`/`reserved` row whose recovery path still got lost.
crons.interval(
  "send-attempt-sweep",
  { minutes: 5 },
  internal.sending.sweepStaleAttemptsGlobal,
  {},
);

// Lifecycle reconcile: a lost schedule or a dead driver otherwise wedges a
// runtime connection mid-transition (`pending`/`accepted`/`uncertain` ops
// with a live Box behind them). Re-drives bounded stale rows every 5 min.
crons.interval(
  "lifecycle-op-sweep",
  { minutes: 5 },
  internal.runtimeConnections.sweepLifecycleOperations,
  {},
);

// Inbound recovery: the AgentMail callback that schedules ingest cannot be
// retried — Workpool does not retry mutations, and the component will not
// re-dispatch an `event_id` it has already ingested — so one lost schedule
// would strand a verified reply forever. This re-drives `pending` inbound
// receipts over an exact `by_direction_and_handlingState_and_receivedAt`
// range — the outbound half never settles unless a send attempt claims it, so
// scanning `handlingState` alone would eventually hand this sweep a page with
// no inbound row in it — and settles the outbound rows that can no longer
// reach an attempt so they stop accumulating.
crons.interval(
  "inbound-receipt-drain",
  { minutes: 5 },
  internal.inbox.drainPendingInboundReceipts,
  {},
);

// A paid provider call that never recorded its outcome must not silently
// keep an allowance reserved forever. This moves those to `uncertain` — which
// KEEPS capacity blocked, deliberately: we cannot prove we were not billed,
// so the honest accounting is an explicit unknown, not a release.
crons.interval(
  "provider-operation-sweep",
  { minutes: 5 },
  internal.integrations.firecrawl.sweepStaleFirecrawlOperations,
  {},
);

// Artifact row→blob reconcile. `sweepOrphanArtifacts` has existed since the
// bridge landed and was on no schedule, because nothing uploaded an artifact.
//
// Stated plainly, because an earlier version of this comment implied
// otherwise: `BridgeClient.uploadArtifact` STILL has zero callers after P21
// (`grep -rn uploadArtifact worker/src/` finds only its own declaration and
// one comment), and the pinned codex 0.154.0 exposes no dynamic-tool
// registration, so the model cannot be told an upload path exists either.
// What P21 changed is the reachability of the drift, not the existence of a
// writer: the research contract carries `artifactIds` and
// `resolveBriefArtifact` reads them, so the first caller will land on a
// reconciled store. Until then this sweep is PRE-EMPTIVE and its correct
// output is zero. Driven once on dev:flexible-grasshopper-949 rather than
// assumed: `npx convex run workerBridge:sweepOrphanArtifacts '{}'` →
// `{"checked": 0, "removed": 0}`.
crons.interval(
  "orphan-artifact-sweep",
  { minutes: 30 },
  internal.workerBridge.sweepOrphanArtifacts,
  {},
);

export default crons;
