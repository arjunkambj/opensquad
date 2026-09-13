import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * Employee status is derived ONLY from real backend state — never simulated.
 *
 * Today the honest inputs are `employee.enabled` and runtime availability.
 * `idle`/`busy`/`blocked` require a connected runtime and live run state;
 * those land with the P07 worker bridge (`convex/runtimeConnections.ts`) and
 * P06 `runs`. Until then every enabled employee is truthfully "disconnected"
 * — the squad cannot execute without a runtime.
 */
export type EmployeeStatus =
  | "idle"
  | "busy"
  | "blocked"
  | "disconnected"
  | "disabled"

/**
 * Whether the workspace runtime (Codex App Server in its ASCII Box) reports a
 * live connection. P07 will expose this via `runtimeConnections.getStatus`;
 * there is no such endpoint yet, so callers pass "disconnected".
 */
export type RuntimeAvailability = "connected" | "disconnected"

export function deriveEmployeeStatus(
  employee: Pick<Doc<"employees">, "enabled">,
  runtime: RuntimeAvailability,
): EmployeeStatus {
  if (!employee.enabled) {
    return "disabled"
  }
  if (runtime === "disconnected") {
    return "disconnected"
  }
  // Connected with no live run information is idle. busy/blocked become
  // reachable once run state exists (P06 `runs` + P07 heartbeats).
  return "idle"
}

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  idle: "Idle",
  busy: "Busy",
  blocked: "Blocked",
  disconnected: "Disconnected",
  disabled: "Disabled",
}

export const EMPLOYEE_STATUS_STYLES: Record<EmployeeStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  busy: "bg-chart-2/15 text-chart-2",
  blocked: "bg-destructive/10 text-destructive",
  disconnected: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground",
}

/** Why a status is shown — used as the badge's supporting copy. */
export const EMPLOYEE_STATUS_DESCRIPTIONS: Record<EmployeeStatus, string> = {
  idle: "Connected and waiting for work.",
  busy: "Running a mission step.",
  blocked: "Waiting on a required decision.",
  disconnected:
    "No runtime connection — available when the workspace runtime bridge ships.",
  disabled: "Turned off by a workspace editor.",
}
