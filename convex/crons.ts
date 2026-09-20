// Convex scheduled jobs.
//
// Every sweep here is a BELT: the primary recovery path for each boundary is
// scheduled transactionally at commit time, and these re-drive the rows whose
// schedule was lost.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Belt for the send boundary: per-attempt sweeps and window wakes are
// scheduled transactionally at commit time, and this sweep re-drives any
// `requesting`/`reserved` row whose recovery path still got lost.
crons.interval(
  "send-attempt-sweep",
  { minutes: 5 },
  internal.outreach.sendSweeps.sweepStaleAttemptsGlobal,
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
  internal.inbox.receiptDrain.drainPendingInboundReceipts,
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

// The same belt for every paid call that goes through `withCredits`: an
// operation whose action died before it could settle is parked `uncertain`,
// which KEEPS its credits and provider units blocked. We cannot prove the
// request never left, and releasing without proof hands back money we may
// already have spent.
crons.interval(
  "paid-call-park-stale",
  { minutes: 5 },
  internal.billing.sweeps.parkStalePaidCalls,
  {},
);

// The other half of PLAN §6's recovery rule: a hold that nothing reconciled
// within 24 hours is committed at its worst case. Hourly is often enough —
// every hold it resolves is a day old by definition.
crons.interval(
  "paid-call-commit-expired-holds",
  { hours: 1 },
  internal.billing.sweeps.commitExpiredHolds,
  {},
);

export default crons;
