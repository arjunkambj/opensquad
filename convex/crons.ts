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
// receipts and is the first consumer of `by_handlingState_and_receivedAt`.
crons.interval(
  "inbound-receipt-drain",
  { minutes: 5 },
  internal.inbox.drainPendingInboundReceipts,
  {},
);

export default crons;
