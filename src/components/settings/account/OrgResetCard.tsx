/**
 * Settings → Account: wipe this organization on a development deployment.
 *
 * Availability and the action both enforce the demo deployment and the
 * organization creator on the server.
 */
import { Delete02Icon } from "@hugeicons/core-free-icons"
import { useNavigate } from "@tanstack/react-router"
import { useAction, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useCurrentOrg } from "@/hooks/use-current-org"
import type { OrgView } from "@/lib/org-view"
import { domainErrorCode } from "@/lib/convex-error"

const CONFIRM_WORD = "RESET"

export function OrgResetCard() {
  const current = useCurrentOrg()
  if (current.status !== "ready") {
    return null
  }
  return <OrgResetForm org={current.org} />
}

function OrgResetForm({ org }: { org: OrgView }) {
  const availability = useQuery(api.orgs.reset.availability, { orgId: org._id })
  const resetOrg = useAction(api.orgs.reset.resetOrg)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (availability === undefined || !availability.enabled) {
    return null
  }

  const confirmed = confirm === CONFIRM_WORD

  async function runReset() {
    if (!confirmed || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await resetOrg({ orgId: org._id })
      await navigate({ replace: true, to: "/onboarding" })
    } catch (cause) {
      if (domainErrorCode(cause) === "NOT_FOUND") {
        await navigate({ replace: true, to: "/onboarding" })
        return
      }
      setError(resetErrorCopy(cause))
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeaderCard
        icon={Delete02Icon}
        title="Reset organization"
        description="Clear this demo organization’s app data and repeat onboarding."
      />
      <Card>
        <CardHeader>
          <CardTitle>Start over</CardTitle>
          <CardDescription>
            Company profile, website scrapes, onboarding, the agent, leads,
            inbox, credits and usage for {org.name} are removed. Your sign-in
            and the Hexclave organization stay. Your provider mailbox and
            provider caches are kept. Available only to this organization’s
            creator on the demo deployment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setConfirm("")
              setError(null)
              setOpen(true)
            }}
          >
            Reset this organization
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) {
            return
          }
          setOpen(next)
          if (!next) {
            setConfirm("")
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset {org.name}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Setup will start again as if this
              organization had never entered the app. Requests already sent
              to providers cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>Company profile, website scrape and onboarding answers.</li>
            <li>The agent, leads, inbox, drafts and sending connection.</li>
            <li>Credits, usage and billing records for this organization.</li>
          </ul>
          <div className="flex flex-col gap-2">
            <Label htmlFor="org-reset-confirm">
              Type {CONFIRM_WORD} to confirm
            </Label>
            <Input
              id="org-reset-confirm"
              autoComplete="off"
              disabled={busy}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
              }}
            />
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false)
              }}
            >
              Keep this data
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!confirmed || busy}
              onClick={() => {
                void runReset()
              }}
            >
              Reset organization
              {busy ? <Spinner className="size-4" /> : null}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function resetErrorCopy(error: unknown): string {
  const code = domainErrorCode(error)
  switch (code) {
    case "FORBIDDEN":
      return "Only this organization’s creator can reset it, on the demo deployment."
    case "RATE_LIMITED":
      return "Wait a moment and try again."
    case "UNAUTHENTICATED":
      return "Your session expired. Sign in again."
    case "CONFLICT":
      return "The reset did not finish. Try again."
    default:
      return "The reset did not finish. Try again."
  }
}
