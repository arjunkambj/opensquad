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

// The overdraft guard (PLAN §6): our ledger counts what we believe each call
// cost, the provider counts what it charged, and the two can drift. This
// reads the real platform balance hourly and trips — or releases — the
// lead-data breaker, so drift can never become an overdraft.
crons.interval(
  "platform-balance-watchdog",
  { hours: 1 },
  internal.billing.platformBalance.checkPlatformBalance,
  {},
);

// The allowed values a lead search may use are case-sensitive and a typo
// silently returns zero rows, so the catalogue behind every strategy is
// refreshed on a schedule rather than trusted to stay right. A failed
// refresh keeps the previous cache; it never empties it.
crons.weekly(
  "lead-filter-options-refresh",
  { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 0 },
  internal.agents.filterOptions.refreshFilterOptions,
  {},
);

// The agent run loop (PLAN §9.1). This is not a belt: it is how a run
// STARTS. "Confirm & find leads" and the end of every run only write
// `nextRunAt`, and this picks up whatever is due — so nothing anywhere holds
// a timer, and a deploy or a crash costs at most one minute of latency. The
// pass itself is one index range over live, due agents; a minute is chosen so
// the first leads appear while the user is still looking at the screen.
crons.interval("agent-run", { minutes: 1 }, internal.agents.run.tickDueAgents, {});

// The outreach loop (PLAN §9.1, §9.3). Like `agent-run` this is not a belt:
// it is how outreach happens at all. `stage` + `nextActionAt` is the whole
// state machine, so each pass reads what is due — a lead to approve, a stale
// draft to retire, an address to buy, a first touch or a follow-up — and
// schedules one short step for it. Every step claims its lead in its own
// transaction before spending, so concurrent ticks cannot double-spend, and a
// minute of latency is all a deploy or a crash costs.
crons.interval(
  "outreach-tick",
  { minutes: 1 },
  internal.outreach.outreachTick.tickOutreach,
  {},
);

// The other half of PLAN §9.1: Convex does not re-run a failed action, so the
// sweep IS the retry. Expired run leases, leads stuck mid-research, and
// `uncertain` email-finder holds that nothing has asked the provider about.
crons.interval(
  "agent-recovery-sweep",
  { minutes: 10 },
  internal.agents.recovery.sweepStalledRuns,
  {},
);

// Belt for the connect-time thread import. Every step schedules the next in
// its own transaction, so a stalled run means a lost scheduled function.
// Re-driving is safe: the cursor says what is still to do and the message
// writer refuses a second row for a message already imported.
crons.interval(
  "inbox-backfill-sweep",
  { minutes: 10 },
  internal.inbox.backfill.sweepStalledBackfills,
  {},
);

export default crons;
