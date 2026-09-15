import { Link } from "@tanstack/react-router"
import { useMutation } from "convex/react"
import { useState } from "react"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { DecisionActionDialog } from "@/components/decisions/DecisionActionDialog"
import { PermissionNote } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import type { WorkspaceRole } from "@/lib/workspace-role"
import { canEdit } from "@/lib/workspace-role"

/** `boundedString(title, "title", { min: 1, max: 200 })` in `missions.ts`. */
const TITLE_MAX = 200

/**
 * Start a sales mission — or say exactly why you cannot.
 *
 * `missions.create` refuses without an **active** campaign whose source plan
 * someone has confirmed. That precondition is checked here, before the click,
 * and the refusal replaces the button with the reason and a link to the step
 * that fixes it. A dead button whose failure only appears after you press it
 * is the thing this avoids.
 *
 * The campaigns arrive from a query the board runs **filtered to `active`**,
 * because the board's own unfiltered dropdown page is bounded at 25 and a
 * refusal derived from it would be a claim about the workspace made from a
 * truncated page. `activeCampaignsTruncated` carries `hasMore` through, so
 * even the wider page cannot pose as the whole workspace when it is not.
 *
 * One `requestId` is minted per opened form and reused on every retry of that
 * form. It is the only thing standing between a double-click and two missions
 * when the first response is lost: `create` looks the id up on
 * `by_workspaceId_and_requestId` and returns the existing row instead of
 * inserting a second one.
 *
 * The other refusal — one live sales mission per campaign — cannot be checked
 * from here without reading every mission on the campaign, so it renders in
 * place in the dialog, quoting the backend's own sentence.
 *
 * The dialog is mounted unconditionally. `eligible` is recomputed from a live
 * subscription on every render, so a teammate completing the workspace's last
 * active campaign can empty it while this form is open; returning the refusal
 * *above* the dialog would unmount the form and throw away a title someone was
 * halfway through typing. The refusal moves inside instead, and every rule
 * this codebase has about a refusal — it is a sentence, it preserves what was
 * typed — still holds.
 */
export function NewMissionDialog({
  workspaceId,
  role,
  activeCampaigns,
  activeCampaignsLoading,
  activeCampaignsTruncated,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
  activeCampaigns: Doc<"campaigns">[]
  activeCampaignsLoading: boolean
  activeCampaignsTruncated: boolean
}) {
  const create = useMutation(api.missions.create)

  const [open, setOpen] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [campaignId, setCampaignId] = useState("")
  const [priority, setPriority] = useState<"normal" | "high">("normal")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `status` was already applied by the server; only the confirmation is left
  // to read off the row.
  const eligible = activeCampaigns.filter(
    (campaign) => campaign.sourcePlan.confirmedBy !== undefined,
  )

  if (!canEdit(role)) {
    return <PermissionNote role={role} action="start a mission" />
  }

  if (activeCampaignsLoading) {
    return (
      <Button size="sm" disabled aria-describedby="new-mission-loading">
        New mission
        <span id="new-mission-loading" className="sr-only">
          Checking whether a confirmed campaign exists.
        </span>
      </Button>
    )
  }

  const noneEligible = eligible.length === 0
  const refusal = `A mission needs an active campaign whose source plan someone has confirmed. ${
    activeCampaignsTruncated
      ? `None of the first ${activeCampaigns.length} active campaigns has one, and this workspace has more than that — so this is not proof there is none.`
      : "There is none yet."
  }`

  const trimmed = title.trim()
  // Defensive rather than positional: a live subscription can retire the
  // campaign the operator picked while the form is open, and `value` falling
  // back to the first remaining option while `submit` still sent the retired
  // id would be the select showing one thing and doing another.
  const chosen = eligible.some((campaign) => campaign._id === campaignId)
    ? campaignId
    : (eligible[0]?._id ?? "")

  const openForm = () => {
    // One id per opened form. Minted here rather than per click, so pressing
    // the button twice is one logical intent, and re-minted on the next open
    // so a second deliberate mission is a second intent.
    setRequestId(crypto.randomUUID())
    setTitle("")
    setCampaignId(eligible[0]?._id ?? "")
    setPriority("normal")
    setError(null)
    setOpen(true)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const mission = await create({
        workspaceId,
        campaignId: chosen as Id<"campaigns">,
        kind: "sales_campaign",
        title: trimmed,
        priority,
        ...(requestId === null ? {} : { requestId }),
      })
      toast.add({
        title: "Mission created",
        description: `"${mission.title}" is in Backlog, waiting to start.`,
        type: "success",
      })
      setOpen(false)
    } catch (cause) {
      setError(
        `${errorMessage(cause, "The mission was not created.")} Nothing was written, and what you typed is still here.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* The refusal takes the button's place rather than sitting under a
          disabled one — but it never takes the DIALOG's place, because an
          open form is somewhere the operator has already typed. */}
      {noneEligible ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{refusal}</p>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/onboarding" search={{ step: "campaign" }} />}
          >
            Set up a campaign
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={openForm}>
          New mission
        </Button>
      )}

      <DecisionActionDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false)
            setError(null)
          }
        }}
        title="Start a sales mission"
        description="The squad discovers and researches prospects, then asks you to approve every email before it leaves. Nothing is sent without a decision from someone here."
        confirmLabel="Start the mission"
        confirmDisabled={
          noneEligible || trimmed.length === 0 || trimmed.length > TITLE_MAX
        }
        // Point at whichever sentence is actually the reason. A disabled
        // control described by the title bound while the real refusal is "no
        // confirmed campaign" is a reachable reason for the wrong thing.
        confirmDescribedBy={
          noneEligible ? "new-mission-no-campaign" : "new-mission-title-bound"
        }
        busy={busy}
        error={error}
        onConfirm={() => void submit()}
      >
        <div className="flex flex-col gap-4">
          {noneEligible ? (
            <p id="new-mission-no-campaign" className="text-sm text-foreground">
              {refusal} Nothing was written and what you typed is still here —
              confirm a campaign in another tab and this form is still usable.
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-mission-title">Title</Label>
            <Input
              id="new-mission-title"
              value={title}
              disabled={busy}
              placeholder="What is this mission for?"
              aria-describedby="new-mission-title-bound"
              onChange={(event) => setTitle(event.target.value)}
            />
            {/* Described, not announced. As a live region this re-spoke the
                count after every keystroke, filling the pauses between words
                with "17 of 200 characters" — and still said nothing on the
                path that needs it, focusing a disabled confirm control whose
                bound was never violated. */}
            <p
              id="new-mission-title-bound"
              className="text-xs text-muted-foreground"
            >
              {trimmed.length > TITLE_MAX
                ? `${trimmed.length} characters — the limit is ${TITLE_MAX}.`
                : `1 to ${TITLE_MAX} characters.`}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="new-mission-campaign">Campaign</Label>
            <NativeSelect
              id="new-mission-campaign"
              value={chosen}
              disabled={busy || noneEligible}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              {eligible.map((campaign) => (
                <option key={campaign._id} value={campaign._id}>
                  {campaign.title}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Only active campaigns with a confirmed source plan are listed,
              and a campaign can hold one live sales mission at a time.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="new-mission-priority">Priority</Label>
            <NativeSelect
              id="new-mission-priority"
              value={priority}
              disabled={busy}
              onChange={(event) =>
                setPriority(event.target.value === "high" ? "high" : "normal")
              }
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </NativeSelect>
          </div>
        </div>
      </DecisionActionDialog>
    </>
  )
}
