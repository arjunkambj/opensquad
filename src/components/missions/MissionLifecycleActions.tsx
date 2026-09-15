import { useMutation } from "convex/react"
import { useState } from "react"
import type { ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { DecisionActionDialog } from "@/components/decisions/DecisionActionDialog"
import { MISSION_STATE_LABEL } from "@/components/missions/mission-presentation"
import { PermissionNote } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import type { WorkspaceRole } from "@/lib/workspace-role"
import { canEdit } from "@/lib/workspace-role"

/** The five lifecycle mutations, which all take the same three arguments. */
type LifecycleAction = "pause" | "resume" | "cancel" | "archive" | "restore"

/**
 * Pause, resume, cancel, archive and restore — every state change a person
 * can make to a mission, and no others.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **The expected version is the one the operator SAW.** Opening or closing
 *    a required ask patches the mission, bumping `version` and `updatedAt`, so
 *    a mission goes stale under an open detail routinely and legitimately.
 *    Re-reading the live version at click time would turn optimistic
 *    concurrency into a silent overwrite, which is the whole thing it exists
 *    to prevent.
 * 2. **A refusal is a sentence, not a disabled button.** Archive on a running
 *    mission is replaced by the reason it cannot happen, in the place the
 *    button would have been.
 * 3. **No Retry on a failed mission.** `MISSION_TRANSITIONS.failed` is exactly
 *    `["cancelled"]`; there is no retry mutation to call. A failed mission
 *    offers Archive and its run receipt.
 *
 * None of these mutations takes a `requestId`, so there is no intent map here:
 * `archive` and `restore` early-return before the version check when already
 * in the target visibility, so a retried request is a no-op rather than a
 * CONFLICT, and the other three do the same for their own idempotent case.
 */
export function MissionLifecycleActions({
  workspaceId,
  mission,
  role,
}: {
  workspaceId: Id<"workspaces">
  mission: Doc<"missions">
  role: WorkspaceRole
}) {
  const pause = useMutation(api.missions.pause)
  const resume = useMutation(api.missions.resume)
  const cancel = useMutation(api.missions.cancel)
  const archive = useMutation(api.missions.archive)
  const restore = useMutation(api.missions.restore)

  const [reviewedVersion, setReviewedVersion] = useState(mission.version)
  const [pending, setPending] = useState<LifecycleAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stale = mission.version !== reviewedVersion

  if (!canEdit(role)) {
    return (
      <PermissionNote
        role={role}
        action="pause, resume, cancel, archive or restore this mission"
      />
    )
  }

  if (stale) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-border px-4 py-3">
        <p className="text-sm text-foreground">
          This mission changed while you had it open — it is now version{" "}
          {mission.version}, not {reviewedVersion}. Load it before acting, so
          you are acting on what is actually here.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReviewedVersion(mission.version)}
        >
          Load the current version
        </Button>
      </div>
    )
  }

  const close = () => {
    if (busy) {
      return
    }
    setPending(null)
    setError(null)
  }

  const run = async (action: LifecycleAction) => {
    setBusy(true)
    setError(null)
    const args = {
      workspaceId,
      missionId: mission._id,
      expectedVersion: reviewedVersion,
    }
    try {
      // Every lifecycle mutation returns the row it wrote, so the new version
      // is read from the write rather than guessed — otherwise this group
      // would declare itself stale against its own successful write the
      // moment the subscription re-rendered.
      const written =
        action === "pause"
          ? await pause(args)
          : action === "resume"
            ? await resume(args)
            : action === "cancel"
              ? await cancel(args)
              : action === "archive"
                ? await archive(args)
                : await restore(args)

      toast.add({
        title: SUCCESS[action].title,
        description: SUCCESS[action].description,
        type: "success",
      })
      setPending(null)
      setReviewedVersion(written.version)
    } catch (cause) {
      setError(
        isConflictError(cause)
          ? `${errorMessage(cause, "This mission moved while you had it open.")} Nothing was written — close this and load the current version.`
          : errorMessage(cause, `Could not ${action} this mission.`),
      )
    } finally {
      setBusy(false)
    }
  }

  const archived = mission.visibility === "archived"
  const canPause =
    mission.state === "queued" ||
    mission.state === "active" ||
    mission.state === "waiting_for_user" ||
    mission.state === "waiting_for_runtime"
  const canResume = mission.state === "paused"
  const canCancel =
    mission.state !== "completed" && mission.state !== "cancelled"
  const canArchive =
    mission.state === "completed" ||
    mission.state === "cancelled" ||
    mission.state === "failed"

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {archived ? null : (
          <>
            {canPause ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending("pause")}
              >
                Pause
              </Button>
            ) : null}
            {canResume ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending("resume")}
              >
                Resume
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending("cancel")}
              >
                Cancel
              </Button>
            ) : null}
          </>
        )}

        {archived ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPending("restore")}
          >
            Restore to the board
          </Button>
        ) : canArchive ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPending("archive")}
          >
            Archive
          </Button>
        ) : null}
      </div>

      {/* The refusal takes the button's place rather than sitting under a
          disabled one, so the reason is where the operator is looking. */}
      {archived || canArchive ? null : (
        <p className="text-sm text-muted-foreground">
          This mission is {MISSION_STATE_LABEL[mission.state].toLowerCase()}.
          Active or waiting work cannot be archived — cancel or complete it
          first.
        </p>
      )}

      {mission.state === "failed" ? (
        <p className="text-sm text-muted-foreground">
          There is no retry. A failed mission can be cancelled or archived;
          starting the work again means creating a replacement mission.
        </p>
      ) : null}

      <DecisionActionDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}
        title={pending === null ? "" : CONFIRM[pending].title}
        description={
          pending === null ? "" : confirmDescription(pending, mission)
        }
        confirmLabel={pending === null ? "" : CONFIRM[pending].confirmLabel}
        confirmVariant={pending === "cancel" ? "destructive" : "default"}
        busy={busy}
        error={error}
        onConfirm={() => {
          if (pending !== null) {
            void run(pending)
          }
        }}
      />
    </div>
  )
}

const CONFIRM: Record<
  LifecycleAction,
  { title: string; confirmLabel: string }
> = {
  pause: { title: "Pause this mission", confirmLabel: "Pause" },
  resume: { title: "Resume this mission", confirmLabel: "Resume" },
  cancel: { title: "Cancel this mission", confirmLabel: "Cancel the mission" },
  archive: { title: "Archive this mission", confirmLabel: "Archive" },
  restore: { title: "Restore this mission", confirmLabel: "Restore" },
}

const SUCCESS: Record<
  LifecycleAction,
  { title: string; description: string }
> = {
  pause: {
    title: "Mission paused",
    description: "Nothing new starts until someone resumes it.",
  },
  resume: {
    title: "Mission resumed",
    description: "The parked workflow was signalled to continue.",
  },
  cancel: {
    title: "Mission cancelled",
    description: "Open asks were retired and in-flight work was swept.",
  },
  archive: {
    title: "Mission archived",
    description: "It is off the board. Its state and outcome are unchanged.",
  },
  restore: {
    title: "Mission restored",
    description: "It is back in its column on the board.",
  },
}

/**
 * The sentence above the confirm button says what the button actually does.
 * Resume is the one that most needs it: a paused mission with open required
 * asks resumes into `waiting_for_user`, so it lands back in **Needs you** and
 * not In flight, and an operator who expected it to start running would read
 * that as a failure.
 */
function confirmDescription(
  action: LifecycleAction,
  mission: Doc<"missions">,
): ReactNode {
  switch (action) {
    case "pause":
      return "Nothing new starts. Work already handed to the runtime may still finish, and mail already accepted by the provider cannot be recalled. It resumes only when a person resumes it."
    case "resume":
      return mission.requiredDecisionCount > 0
        ? `This mission has ${mission.requiredDecisionCount} required ${
            mission.requiredDecisionCount === 1 ? "ask" : "asks"
          } open, so resuming puts it back in Needs you — not In flight. It runs once those are answered.`
        : "It goes back to In flight and the parked workflow is signalled to continue."
    case "cancel":
      return "Every open ask is retired, child work is cancelled and in-flight runs are swept. This cannot be undone — a cancelled mission never runs again — and mail already accepted by the provider cannot be recalled."
    case "archive":
      return "Archive hides it from the board. It does not claim the work succeeded and changes nothing about the state or the outcome. You can find it again with the Archived view and restore it."
    case "restore":
      return "It returns to its column on the board with its state and outcome unchanged."
  }
}
