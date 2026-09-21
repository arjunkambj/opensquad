/**
 * Settings → Account: wipe this organization on a development deployment.
 *
 * Availability and the action both enforce the demo deployment and the
 * organization creator on the server.
 */
import { useNavigate } from "@tanstack/react-router"
import { useAction, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import { PageSection } from "@/components/kit/PageSection"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
      <PageSection
        title="Reset organization"
        description="Clears this demo organization's data and restarts setup."
      >
        <div>
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
        </div>
      </PageSection>
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
          <div className="flex flex-col gap-4">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              <li>Company profile, website scrape and onboarding answers.</li>
              <li>The agent, leads, inbox, drafts and sending connection.</li>
              <li>Credits, usage and billing records for this organization.</li>
            </ul>
            <Field>
              <FieldLabel htmlFor="org-reset-confirm">
                Type {CONFIRM_WORD} to confirm
              </FieldLabel>
              <Input
                id="org-reset-confirm"
                autoComplete="off"
                disabled={busy}
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value)
                }}
              />
            </Field>
            <FormError message={error} />
          </div>
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
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Reset organization
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
