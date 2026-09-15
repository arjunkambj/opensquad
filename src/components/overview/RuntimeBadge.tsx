import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatWaited } from "@/components/decisions/decision-presentation"
import { Button } from "@/components/ui/button"

/**
 * Mirrors `RUNTIME_LIVE_WINDOW_MS` in `convex/lib/validators.ts`. Copied
 * rather than imported: it is a value export, and importing it would pull the
 * convex module graph into the browser bundle for one number.
 */
const RUNTIME_LIVE_WINDOW_MS = 90_000

/** How often the client rechecks freshness. Well inside the live window. */
const TICK_MS = 15_000

/**
 * The workspace's runtime, and the board's only liveness surface.
 *
 * `getStatus().live` is `state === "ready" && freshHeartbeat`, and that
 * freshness is a clock comparison computed **inside the query**. Convex
 * re-runs a query when a document changes, not when time passes — so a page
 * left open would keep claiming "live" long after the worker died. Hence the
 * tick: the client recomputes freshness from `lastHeartbeatAt` and can only
 * ever **degrade** the backend's verdict, never upgrade it. An indicator that
 * keeps running after the runtime is gone is exactly the lie `plan/ux.md` §6
 * forbids.
 *
 * Three states, never collapsed into two, because they need different actions:
 * never connected, connected but not live, and live. Each is carried by a
 * **word** and is readable without colour (V10).
 *
 * Nothing here animates and nothing per-mission does either: `vRuntimeStatus`
 * does not expose `currentRunId`, and `mission.state === "active"` is not an
 * execution signal — a mission can be active with a dead runtime.
 */
export function RuntimeBadge({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">
}) {
  const status = useQuery(api.runtimeConnections.getStatus, { workspaceId })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  if (status === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking the runtime…
      </p>
    )
  }

  // `exists` sits on BOTH variants of `vRuntimeStatus` and therefore does not
  // narrow; the connected variant is the one carrying `state`. This is the
  // same discrimination `RuntimeSection` uses.
  if (!("state" in status)) {
    return (
      <Shell heading="Runtime never connected" tone="muted">
        <span>No runtime has ever been connected to this workspace.</span>
        <Button
          variant="outline"
          size="xs"
          render={<Link to="/settings" search={{ section: "runtime" }} />}
        >
          Connect it in Settings
        </Button>
      </Shell>
    )
  }

  const fresh =
    status.lastHeartbeatAt !== undefined &&
    now - status.lastHeartbeatAt < RUNTIME_LIVE_WINDOW_MS

  if (status.live && fresh) {
    return (
      <Shell heading="Runtime live" tone="live">
        <span>Heartbeat {formatWaited(status.lastHeartbeatAt ?? now, now)}.</span>
      </Shell>
    )
  }

  // A fully booted worker that has not finished the managed login heartbeats
  // happily and `live` stays false. Calling that "offline" would send someone
  // to restart a service that is running perfectly well.
  const bootingWithHeartbeat =
    fresh && (status.state === "connecting" || status.state === "provisioning")

  if (bootingWithHeartbeat) {
    return (
      <Shell heading="Runtime connected, not signed in" tone="warn">
        <span>
          The worker is reporting in, but it has not completed sign-in, so
          nothing can execute yet.
        </span>
        <Button
          variant="outline"
          size="xs"
          render={<Link to="/settings" search={{ section: "runtime" }} />}
        >
          Finish it in Settings
        </Button>
      </Shell>
    )
  }

  return (
    <Shell heading="Runtime disconnected" tone="warn">
      <span>
        {status.lastHeartbeatAt === undefined
          ? "Connected, but it has never sent a heartbeat."
          : `Last heard from ${formatWaited(status.lastHeartbeatAt, now)}.`}{" "}
        Missions cannot run until it is back.
      </span>
      <Button
        variant="outline"
        size="xs"
        render={<Link to="/settings" search={{ section: "runtime" }} />}
      >
        Runtime settings
      </Button>
    </Shell>
  )
}

function Shell({
  heading,
  tone,
  children,
}: {
  heading: string
  tone: "live" | "warn" | "muted"
  children: ReactNode
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      <span
        className={
          tone === "live"
            ? "font-medium text-chart-2"
            : tone === "warn"
              ? "font-medium text-chart-1"
              : "font-medium text-foreground"
        }
      >
        {heading}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  )
}
