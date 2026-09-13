import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * Employee status is derived ONLY from real backend state — never simulated.
 *
 * The honest inputs are `employee.enabled` and the P07 runtime's live signal
 * (`runtimeConnections.getStatus` → `live`: state `ready` with a fresh
 * heartbeat). A connected runtime with no live run information shows `idle`;
 * `busy`/`blocked` become reachable once run state is surfaced (P12 reads
 * P06 `runs`). With no live runtime every enabled employee is truthfully
 * "disconnected" — the squad cannot execute without one.
 */
export type EmployeeStatus =
  | "idle"
  | "busy"
  | "blocked"
  | "disconnected"
  | "disabled"

/**
 * Whether the workspace runtime (Codex App Server in its ASCII Box) reports a
 * live connection — `runtimeConnections.getStatus` `exists && live`.
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
  // reachable once run state is surfaced (P12 reads P06 `runs`).
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
    "No live runtime connection — the owner can connect one in Settings.",
  disabled: "Turned off by a workspace editor.",
}
