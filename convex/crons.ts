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

export default crons;
