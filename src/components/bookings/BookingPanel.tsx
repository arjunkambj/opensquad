import { useEffect, useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import {
  CancelBookingDialog,
  ConfirmBookingDialog,
  OutcomeDialog,
  ProposeBookingDialog,
} from "@/components/bookings/BookingDialogs"
import { DraftProposalDialog } from "@/components/bookings/DraftProposalDialog"
import { BookingDraftLink } from "@/components/bookings/BookingDraftLink"
import {
  BookingStateChip,
  proposalSummary,
} from "@/components/bookings/booking-presentation"
import {
  formatInstant,
  formatWaited,
} from "@/components/shared/presentation"
import { memberLabel } from "@/components/leads/leads-presentation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type LeadDetailResult = FunctionReturnType<typeof api.prospects.getDetail>

/**
 * The Booking tab — the record of an agreement, on the lead.
 *
 * The section opens with the one fact every control here is shaped by:
 * **this never sends invitations or touches a calendar.** A booking is what
 * two people agreed, not what a provider holds; the proposal rides out on an
 * ordinary approved draft, and a human records the agreed time afterwards.
 *
 * At most one ACTIVE booking exists per lead (proposed or confirmed — the
 * backend enforces it transactionally). If the data ever shows two, both
 * render with a note rather than the UI pretending the invariant held.
 */
export function BookingPanel({
  workspaceId,
  detail,
  leadExpectedVersion,
  leadStale,
  canEdit,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  detail: LeadDetailResult
  leadExpectedVersion: number
  leadStale: boolean
  canEdit: boolean
  timezone: string
}) {
  const prospect = detail.prospect
  const active = detail.bookings.filter(
    (booking) => booking.state === "proposed" || booking.state === "confirmed",
  )
  const history = detail.bookings.filter(
    (booking) => booking.state !== "proposed" && booking.state !== "confirmed",
  )

  return (
    <section
      aria-label="Booking"
      className="flex flex-col gap-4 rounded-xl bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Booking</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A booking here records what the lead AGREED to — nothing in this
          section sends a calendar invitation or writes to a calendar. The
          proposal goes out on an approved email; when the lead agrees to a
          time, a person records it here.
        </p>
      </div>

      {active.length === 0 ? (
        <NoActiveBooking
          workspaceId={workspaceId}
          prospectId={prospect._id}
          leadExpectedVersion={leadExpectedVersion}
          leadStale={leadStale}
          canEdit={canEdit}
          leadStage={prospect.salesStage}
        />
      ) : (
        active.map((booking) => (
          <ActiveBookingCard
            key={booking._id}
            workspaceId={workspaceId}
            booking={booking}
            detail={detail}
            canEdit={canEdit}
            leadStale={leadStale}
            timezone={timezone}
          />
        ))
      )}
      {active.length > 1 ? (
        <p role="alert" className="text-xs text-destructive">
          This lead shows {active.length} active bookings — the write path
          enforces at most one. Both records are shown as stored; cancel one
          to restore the invariant.
        </p>
      ) : null}

      {history.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
          <h4 className="text-xs font-medium text-muted-foreground">
            Earlier bookings
          </h4>
          <ul className="flex flex-col gap-2">
            {history.map((booking) => (
              <HistoryRow
                key={booking._id}
                booking={booking}
                timezone={timezone}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/**
 * No live booking: the honest empty state plus the one thing that can create
 * one — proposing. "Propose" writes the RECORD; it never implies anything
 * was sent, which is why the empty state says so before the button does.
 */
function NoActiveBooking({
  workspaceId,
  prospectId,
  leadExpectedVersion,
  leadStale,
  canEdit,
  leadStage,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  leadExpectedVersion: number
  leadStale: boolean
  canEdit: boolean
  leadStage: Doc<"prospects">["salesStage"]
}) {
  const [proposeOpen, setProposeOpen] = useState(false)
  const terminal = leadStage === "won" || leadStage === "lost"

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        No live booking — nothing has been proposed to this lead yet.
      </p>
      {terminal ? (
        <p className="text-xs text-muted-foreground">
          The lead is {leadStage} — a stage correction must reopen it before a
          booking can be proposed.
        </p>
      ) : canEdit ? (
        <Button
          variant="outline"
          size="sm"
          disabled={leadStale}
          onClick={() => setProposeOpen(true)}
        >
          Propose a booking
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          You have read-only access to this workspace. An owner or operator
          can propose a booking.
        </p>
      )}
      {leadStale && canEdit ? (
        <p className="text-xs text-muted-foreground">
          The lead changed since you opened it — resolve the banner above
          before proposing.
        </p>
      ) : null}
      <ProposeBookingDialog
        workspaceId={workspaceId}
        prospectId={prospectId}
        leadExpectedVersion={leadExpectedVersion}
        open={proposeOpen}
        onOpenChange={setProposeOpen}
      />
    </div>
  )
}

/**
 * The live booking card: what was offered, what (if anything) was agreed,
 * and the actions the state allows. `booking.version` is pinned at mount —
 * a live write lands under the version the operator SAW, and a version that
 * moved gets the banner, never a silent re-pin.
 */
function ActiveBookingCard({
  workspaceId,
  booking,
  detail,
  canEdit,
  leadStale,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  detail: LeadDetailResult
  canEdit: boolean
  leadStale: boolean
  timezone: string
}) {
  const [seenVersion, setSeenVersion] = useState(booking.version)
  const stale = booking.version !== seenVersion

  const [draftOpen, setDraftOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  // "Has the meeting started" must flip while the card stays mounted, so a
  // confirmed booking ticks on a slow timer until its start arrives — then
  // the interval clears itself rather than re-rendering forever (a wall-clock
  // re-check per render would be an impure call).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const startsAt = booking.startsAt
    if (booking.state !== "confirmed" || startsAt === undefined) {
      return
    }
    const tick = () => {
      const at = Date.now()
      setNow(at)
      if (startsAt <= at) {
        clearInterval(handle)
      }
    }
    const handle = setInterval(tick, 15_000)
    tick()
    return () => clearInterval(handle)
  }, [booking.state, booking.startsAt])
  const meetingPassed =
    booking.startsAt !== undefined && booking.startsAt <= now

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border/60 p-4",
        stale && "border-chart-1/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <BookingStateChip state={booking.state} />
        <span className="text-xs text-muted-foreground">
          proposed {formatWaited(booking.createdAt)} · owner{" "}
          {memberLabel(booking.ownerIdentityKey)}
        </span>
      </div>

      {stale ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-chart-1/10 px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-xs text-foreground">
            This booking changed underneath you (you read version {seenVersion};
            it is now version {booking.version}). What you typed is still in the
            dialogs — act on the version you saw, or re-check the record first.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSeenVersion(booking.version)}
          >
            Use version {booking.version}
          </Button>
        </div>
      ) : null}

      {/* What was offered — a link or the offered slots, verbatim. The
          `proposal` const carries the narrowing INTO the slot map, which a
          `booking.proposal` property chain cannot. */}
      {(() => {
        const proposal = booking.proposal
        return (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {proposalSummary(proposal, timezone)}
            </p>
            {proposal.kind === "booking_link" ? (
              <a
                href={proposal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm text-foreground underline underline-offset-2"
              >
                {proposal.url}
              </a>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {proposal.slots.map((slot, index) => (
                  <li key={index} className="text-sm text-foreground">
                    {formatInstant(slot.startsAt, proposal.timezone)} –{" "}
                    {formatInstant(slot.endsAt, proposal.timezone)}
                    <span className="text-muted-foreground">
                      {" "}
                      ({proposal.timezone})
                      {slot.startsAt <= now ? " — passed" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })()}

      {/* What was agreed — present only on states that carry it. */}
      {booking.startsAt !== undefined &&
      booking.endsAt !== undefined &&
      booking.timezone !== undefined ? (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            Agreed time{booking.state === "cancelled" ? " (cancelled)" : ""}
          </p>
          <p className="text-sm text-foreground">
            {formatInstant(booking.startsAt, booking.timezone)} –{" "}
            {formatInstant(booking.endsAt, booking.timezone)}
            <span className="text-muted-foreground"> ({booking.timezone})</span>
          </p>
          {booking.confirmationNote !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Confirmed on the basis of: {booking.confirmationNote}
              {booking.confirmedBy !== undefined
                ? ` · recorded by ${memberLabel(booking.confirmedBy)}`
                : ""}
              {booking.confirmedAt !== undefined
                ? ` · ${formatInstant(booking.confirmedAt, timezone)}`
                : ""}
            </p>
          ) : null}
          {booking.cancellationReason !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Cancelled because: {booking.cancellationReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The outbound draft that carries this proposal — linked to its
          approval ask on the shared Decisions queue. */}
      {booking.draftId !== undefined ? (
        <BookingDraftLink
          workspaceId={workspaceId}
          draftId={booking.draftId}
          bookingVersion={booking.version}
        />
      ) : null}

      {/* Actions — what the state allows, gated by role and staleness. */}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {booking.state === "proposed" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={stale || leadStale}
                onClick={() => setDraftOpen(true)}
              >
                {booking.draftId === undefined
                  ? "Write the proposal email"
                  : "Revise the proposal email"}
              </Button>
              <Button
                size="sm"
                disabled={stale || leadStale}
                onClick={() => setConfirmOpen(true)}
              >
                Record the agreed time
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={stale || leadStale}
                onClick={() => setCancelOpen(true)}
              >
                Cancel proposal
              </Button>
            </>
          ) : null}
          {booking.state === "confirmed" ? (
            <>
              <Button
                size="sm"
                disabled={stale || leadStale || !meetingPassed}
                onClick={() => setOutcomeOpen(true)}
              >
                Record outcome
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={stale || leadStale || meetingPassed}
                onClick={() => setRescheduleOpen(true)}
              >
                Reschedule
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={stale || leadStale}
                onClick={() => setCancelOpen(true)}
              >
                Cancel the booking
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          You have read-only access to this workspace. An owner or operator
          can act on a booking.
        </p>
      )}
      {booking.state === "confirmed" && !meetingPassed ? (
        <p className="text-xs text-muted-foreground">
          The outcome is recorded after the meeting starts — it has not yet.
        </p>
      ) : null}
      {booking.state === "confirmed" && meetingPassed ? (
        <p className="text-xs text-muted-foreground">
          The meeting time has passed — record how it went, or cancel with the
          reason it did not happen.
        </p>
      ) : null}
      {(stale || leadStale) && canEdit ? (
        <p className="text-xs text-muted-foreground">
          {stale
            ? "Resolve the version banner above before acting."
            : "The lead changed since you opened it — resolve its banner before acting on the booking."}
        </p>
      ) : null}

      <DraftProposalDialog
        workspaceId={workspaceId}
        booking={booking}
        detail={detail}
        expectedVersion={seenVersion}
        open={draftOpen}
        onOpenChange={setDraftOpen}
        timezone={timezone}
      />
      <ConfirmBookingDialog
        workspaceId={workspaceId}
        booking={booking}
        expectedVersion={seenVersion}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
      <ConfirmBookingDialog
        workspaceId={workspaceId}
        booking={booking}
        expectedVersion={seenVersion}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        reschedule
      />
      <CancelBookingDialog
        workspaceId={workspaceId}
        booking={booking}
        expectedVersion={seenVersion}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        timezone={timezone}
      />
      <OutcomeDialog
        workspaceId={workspaceId}
        booking={booking}
        expectedVersion={seenVersion}
        open={outcomeOpen}
        onOpenChange={setOutcomeOpen}
        timezone={timezone}
      />
    </div>
  )
}

/** A closed booking — readable, never editable. */
function HistoryRow({
  booking,
  timezone,
}: {
  booking: Doc<"bookings">
  timezone: string
}) {
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <BookingStateChip state={booking.state} />
        <span className="text-xs text-muted-foreground">
          {formatWaited(booking.updatedAt)}
        </span>
      </div>
      <p className="text-sm text-foreground">
        {booking.startsAt !== undefined &&
        booking.endsAt !== undefined &&
        booking.timezone !== undefined
          ? `${formatInstant(booking.startsAt, booking.timezone)} – ${formatInstant(booking.endsAt, booking.timezone)} (${booking.timezone})`
          : proposalSummary(booking.proposal, timezone)}
      </p>
      {booking.cancellationReason !== undefined ? (
        <p className="text-xs text-muted-foreground">
          {booking.cancellationReason}
        </p>
      ) : null}
      {booking.state === "completed" && booking.confirmationNote !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Confirmed on the basis of: {booking.confirmationNote}
        </p>
      ) : null}
    </li>
  )
}
