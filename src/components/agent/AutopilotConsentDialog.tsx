/**
 * The Autopilot consent dialog (PLAN §9.3).
 *
 * This is the ONLY way Autopilot is ever turned on: its Accept is what sends
 * the consent payload `agents.settingsMode.setMode` requires, and the backend
 * refuses the mode without it. Nothing here is decorative — every sentence is
 * a thing the agent will then do without asking, and every number is the
 * agent's own stored cap and the real credit price, not an illustration.
 *
 * Presentational: the caller owns the mutation and its refusals.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"
import { ACTION_PRICES } from "../../../convex/lib/prices"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import type { AgentDoc } from "./agent-model"

function Clause({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="text-muted-foreground">
        •
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

export function AutopilotConsentDialog({
  agent,
  dailySendLimit,
  open,
  saving,
  error,
  onOpenChange,
  onAccept,
}: {
  agent: AgentDoc
  /** The org's own ceiling on mail per day — the send limit it will
   *  never exceed, whatever the agent's caps say. */
  dailySendLimit: number
  open: boolean
  saving: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onAccept: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            Let the agent work on its own
          </DialogTitle>
          <DialogDescription>
            On Autopilot the agent stops asking you first. This is exactly what
            it will do.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2 text-sm text-foreground">
          <Clause>
            <span className="font-medium">Approve leads itself</span> — every
            lead it scores {agent.autoApproveMinScore} out of 3 or higher. You
            can still reject any of them.
          </Clause>
          <Clause>
            <span className="font-medium">Spend credits to find addresses</span>{" "}
            — {ACTION_PRICES.get_email.credits} credits each, for at most{" "}
            {agent.autoRevealDailyCap} leads a day.
          </Clause>
          <Clause>
            <span className="font-medium">Send without showing you first</span>{" "}
            — from your connected inbox, inside your sending window and at most{" "}
            {dailySendLimit} emails a day, and it follows up{" "}
            {agent.followUpDays.length === 0
              ? "never"
              : `${agent.followUpDays.length} time${agent.followUpDays.length === 1 ? "" : "s"}`}{" "}
            while nobody answers.
          </Clause>
          <Clause>
            <span className="font-medium">Reply on your behalf</span> — at most
            two replies per conversation, then it hands the thread to you. It
            never answers someone who asked to be left alone, and it never
            marks a meeting as booked.
          </Clause>
          <Clause>
            It researches at most {agent.dailyResearchCap} new leads a day and
            searches for at most {agent.dailyLeadCap} new leads a day.
          </Clause>
        </ul>

        <p className="text-sm text-muted-foreground">
          You can switch back to Review or Paused at any moment, and that stops
          anything that has not been sent yet.
        </p>

        <FormError message={error} />

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={saving} />}>
            Not now
          </DialogClose>
          <Button disabled={saving} onClick={onAccept}>
            {saving ? <Spinner data-icon="inline-start" /> : null}
            Turn on Autopilot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
