import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type { BookingProposal } from "../../../convex/lib/validators"
import { formatInstant } from "@/components/decisions/decision-presentation"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { civilTimeToUtcMs } from "@/lib/date-ranges"
import { useIntentId } from "@/lib/use-intent-id"
import { detectLocalTimezone, timezoneOptions } from "@/lib/workspace-time"

/**
 * The booking write dialogs. Three rules they all keep:
 *
 * - The stated basis is always human-typed. A confirmation, a cancellation
 *   and a reschedule each demand a reason/note the operator writes — the UI
 *   never invents one, and a send or a reply classification is never one
 *   (V24).
 * - Every submit sends `expectedVersion` — the version of the booking the
 *   operator READ — so a concurrent transition conflicts instead of
 *   clobbering.
 * - `requestId` is per intent (`useIntentId`): a retry replays the same
 *   intent, a success rotates it.
 * - Reopening is a new intent: every form's state lives in a `*Form` child
 *   inside `DialogContent`, which unmounts on close — a dismissed attempt
 *   leaves nothing behind in the fields, the banner, or the requestId.
 */

function mutationErrorMessage(error: unknown): string {
  if (isConflictError(error)) {
    return `${errorMessage(error, "The change conflicts with a newer version.")} Your entries are unchanged — re-check the booking, then try again.`
  }
  return errorMessage(error, "The change could not be saved.")
}

/**
 * date + time input → epoch ms in `timezone`, or a sentence about why not.
 * `civilTimeToUtcMs` reports gap/overlap times rather than repairing them —
 * a booking recorded against the wrong instant is worse than a refused one.
 * A plain function, not a hook — it is called inside a slot `.map`, where a
 * hook could never live.
 */
function civilTimeMs(
  date: string,
  time: string,
  timezone: string,
): { ms: number | undefined; error: string | null } {
  if (date === "") {
    return { ms: undefined, error: null }
  }
  const parsed = civilTimeToUtcMs(date, time === "" ? "09:00" : time, timezone)
  if (!parsed.ok) {
    return {
      ms: undefined,
      error:
        parsed.reason === "impossible_time"
          ? `That clock time does not exist in ${timezone} — the zone skips it (a daylight-saving gap). Pick a different time.`
          : parsed.reason === "unreadable_zone"
            ? `${timezone} is not a timezone this browser knows — pick a different zone.`
            : "Enter a valid date and time.",
    }
  }
  if (parsed.ambiguous) {
    return {
      ms: undefined,
      error: `That clock time occurs twice in ${timezone} (a daylight-saving repeat) — pick a different time so the record is unambiguous.`,
    }
  }
  return { ms: parsed.ms, error: null }
}

/* ------------------------------------------------------------------ */
/* Propose                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record a proposal — a booking link, or up to three offered slots under one
 * IANA timezone. The dialog says the thing the record does NOT do before it
 * asks for the fields: no email is sent by proposing, and no meeting is
 * agreed by it.
 */
export function ProposeBookingDialog({
  workspaceId,
  prospectId,
  leadExpectedVersion,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  leadExpectedVersion: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose a booking</DialogTitle>
          <DialogDescription>
            Record what you mean to offer — a public booking link, or up to
            three times the lead could pick. Recording this sends nothing and
            agrees nothing; the proposal goes out on an approved email.
          </DialogDescription>
        </DialogHeader>
        <ProposeBookingForm
          workspaceId={workspaceId}
          prospectId={prospectId}
          leadExpectedVersion={leadExpectedVersion}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function ProposeBookingForm({
  workspaceId,
  prospectId,
  leadExpectedVersion,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  leadExpectedVersion: number
  onOpenChange: (open: boolean) => void
}) {
  const propose = useMutation(api.bookings.propose)
  const [requestId, rotateIntent] = useIntentId()

  const [kind, setKind] = useState<"booking_link" | "slots">("booking_link")
  const [url, setUrl] = useState("")
  const [slotZone, setSlotZone] = useState(detectLocalTimezone())
  const [slots, setSlots] = useState<{ date: string; time: string; end: string }[]>([
    { date: "", time: "", end: "" },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkValid = /^https?:\/\//i.test(url.trim())

  const submit = () => {
    let proposal: BookingProposal
    if (kind === "booking_link") {
      if (!linkValid) {
        setError("Enter the public http(s) booking link you mean to offer.")
        return
      }
      proposal = { kind: "booking_link", url: url.trim() }
    } else {
      const built: { startsAt: number; endsAt: number }[] = []
      for (const [index, slot] of slots.entries()) {
        const start = civilTimeMs(slot.date, slot.time, slotZone)
        const end = civilTimeMs(slot.date, slot.end, slotZone)
        if (slot.date === "" || slot.time === "" || slot.end === "") {
          setError(`Slot ${index + 1} needs a date, a start and an end.`)
          return
        }
        if (start.error !== null || end.error !== null) {
          setError(`Slot ${index + 1}: ${start.error ?? end.error ?? ""}`)
          return
        }
        if (start.ms === undefined || end.ms === undefined) {
          setError(`Slot ${index + 1} needs a valid start and end time.`)
          return
        }
        if (end.ms <= start.ms) {
          setError(`Slot ${index + 1}'s end must be after its start.`)
          return
        }
        if (end.ms - start.ms > 24 * 3_600_000) {
          setError(`Slot ${index + 1} is longer than 24 hours.`)
          return
        }
        if (start.ms <= Date.now()) {
          setError(`Slot ${index + 1} is not in the future.`)
          return
        }
        built.push({ startsAt: start.ms, endsAt: end.ms })
      }
      proposal = { kind: "slots", timezone: slotZone, slots: built }
    }
    setBusy(true)
    setError(null)
    void propose({
      workspaceId,
      prospectId,
      expectedLeadVersion: leadExpectedVersion,
      proposal,
      requestId,
    })
      .then(() => {
        toast.add({ title: "Proposal recorded — nothing was sent", type: "success" })
        rotateIntent()
        onOpenChange(false)
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="proposal-kind">Offer as</Label>
            <NativeSelect
              id="proposal-kind"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as "booking_link" | "slots")
              }
            >
              <option value="booking_link">A booking link</option>
              <option value="slots">Specific times</option>
            </NativeSelect>
          </div>

          {kind === "booking_link" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="proposal-url">Public booking link</Label>
              <Input
                id="proposal-url"
                type="url"
                value={url}
                placeholder="https://cal.example.com/your-name"
                onChange={(event) => setUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The link must be publicly reachable over http(s) — it is
                offered, never opened or synced.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="proposal-zone">Timezone for the times</Label>
                <NativeSelect
                  id="proposal-zone"
                  value={slotZone}
                  onChange={(event) => setSlotZone(event.target.value)}
                >
                  {timezoneOptions(slotZone).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  The times are offered in this zone — the zone travels with
                  the proposal, so the lead sees the same times you picked.
                </p>
              </div>
              {slots.map((slot, index) => (
                <SlotFields
                  key={index}
                  index={index}
                  slot={slot}
                  zone={slotZone}
                  removable={slots.length > 1}
                  onChange={(next) =>
                    setSlots((current) =>
                      current.map((entry, i) => (i === index ? next : entry)),
                    )
                  }
                  onRemove={() =>
                    setSlots((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                />
              ))}
              {slots.length < 3 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    setSlots((current) => [
                      ...current,
                      { date: "", time: "", end: "" },
                    ])
                  }
                >
                  Add another time
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? <Spinner className="size-3.5" /> : null}
            Record the proposal
          </Button>
        </DialogFooter>
    </>
  )
}

/** One offered slot's inputs — a date, a start time and an end time, all read
 *  in the picker zone. */
function SlotFields({
  index,
  slot,
  zone,
  removable,
  onChange,
  onRemove,
}: {
  index: number
  slot: { date: string; time: string; end: string }
  zone: string
  removable: boolean
  onChange: (slot: { date: string; time: string; end: string }) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Option {index + 1}
        </span>
        {removable ? (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`slot-${index}-date`} className="text-xs">
            Date
          </Label>
          <Input
            id={`slot-${index}-date`}
            type="date"
            value={slot.date}
            onChange={(event) =>
              onChange({ ...slot, date: event.target.value })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`slot-${index}-start`} className="text-xs">
            From
          </Label>
          <Input
            id={`slot-${index}-start`}
            type="time"
            value={slot.time}
            onChange={(event) =>
              onChange({ ...slot, time: event.target.value })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`slot-${index}-end`} className="text-xs">
            To
          </Label>
          <Input
            id={`slot-${index}-end`}
            type="time"
            value={slot.end}
            onChange={(event) =>
              onChange({ ...slot, end: event.target.value })
            }
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Times read in {zone}.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Confirm / reschedule                                                */
/* ------------------------------------------------------------------ */

/**
 * "Record the agreed time" and "Reschedule" — one dialog, two mutations.
 * Both take the same fields (start, end, timezone) because both rewrite the
 * agreement; reschedule adds a required reason. A confirmation is a human
 * record of a human agreement — the dialog asks how the time was agreed so
 * the record keeps its basis, and it says plainly that nothing is sent.
 */
export function ConfirmBookingDialog({
  workspaceId,
  booking,
  expectedVersion,
  open,
  onOpenChange,
  reschedule = false,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  expectedVersion: number
  open: boolean
  onOpenChange: (open: boolean) => void
  reschedule?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reschedule ? "Reschedule the meeting" : "Record the agreed time"}
          </DialogTitle>
          <DialogDescription>
            {reschedule
              ? "Move the confirmed meeting. Any unsent draft still offering the old times is retired with it — a draft can never offer a time that is no longer the agreement."
              : "The lead agreed to a time — record it. Nothing is sent and no calendar is touched; this is the record of the agreement, not the mechanism of it."}
          </DialogDescription>
        </DialogHeader>
        <ConfirmBookingForm
          workspaceId={workspaceId}
          booking={booking}
          expectedVersion={expectedVersion}
          onOpenChange={onOpenChange}
          reschedule={reschedule}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConfirmBookingForm({
  workspaceId,
  booking,
  expectedVersion,
  onOpenChange,
  reschedule,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  expectedVersion: number
  onOpenChange: (open: boolean) => void
  reschedule: boolean
}) {
  const confirm = useMutation(api.bookings.confirm)
  const rescheduleMutation = useMutation(api.bookings.reschedule)
  const [requestId, rotateIntent] = useIntentId()

  const [date, setDate] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [zone, setZone] = useState(
    booking.timezone ?? detectLocalTimezone(),
  )
  const [basis, setBasis] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startsAt = civilTimeMs(date, start, zone)
  const endsAt = civilTimeMs(date, end, zone)

  const submit = () => {
    if (date === "" || start === "" || end === "") {
      setError("Enter the agreed date, start and end.")
      return
    }
    if (startsAt.error !== null || endsAt.error !== null) {
      setError(startsAt.error ?? endsAt.error ?? "")
      return
    }
    if (startsAt.ms === undefined || endsAt.ms === undefined) {
      setError("Enter the agreed date, start and end.")
      return
    }
    if (endsAt.ms <= startsAt.ms) {
      setError("The end must be after the start.")
      return
    }
    if (endsAt.ms - startsAt.ms > 24 * 3_600_000) {
      setError("A meeting longer than 24 hours is a data error, not a booking.")
      return
    }
    if (endsAt.ms <= Date.now()) {
      setError(
        "The agreed meeting must still be upcoming — a past meeting is an outcome to record, not a confirmation.",
      )
      return
    }
    if (reschedule && reason.trim() === "") {
      setError("Say why the meeting is moving — the record keeps the reason.")
      return
    }
    if (!reschedule && basis.trim() === "") {
      setError(
        "Say how the time was agreed — e.g. “they picked the link’s Tuesday slot in their reply”.",
      )
      return
    }
    setBusy(true)
    setError(null)
    const call = reschedule
      ? rescheduleMutation({
          workspaceId,
          bookingId: booking._id,
          expectedVersion,
          startsAt: startsAt.ms,
          endsAt: endsAt.ms,
          timezone: zone,
          reason: reason.trim(),
          requestId,
        })
      : confirm({
          workspaceId,
          bookingId: booking._id,
          expectedVersion,
          startsAt: startsAt.ms,
          endsAt: endsAt.ms,
          timezone: zone,
          confirmationNote: basis.trim(),
          requestId,
        })
    void call
      .then(() => {
        toast.add({
          title: reschedule
            ? "Meeting rescheduled — the new time is the agreement"
            : "Booking confirmed — the agreed time is recorded",
          type: "success",
        })
        rotateIntent()
        onOpenChange(false)
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-date">Date</Label>
              <Input
                id="bk-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-start">Starts</Label>
              <Input
                id="bk-start"
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-end">Ends</Label>
              <Input
                id="bk-end"
                type="time"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-zone">Timezone</Label>
            <NativeSelect
              id="bk-zone"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
            >
              {timezoneOptions(zone).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              The zone the agreed clock times live in — recorded with the
              booking so the instant is unambiguous.
            </p>
          </div>
          {reschedule ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-reason">Why it is moving — required</Label>
              <Textarea
                id="bk-reason"
                value={reason}
                rows={2}
                maxLength={200}
                placeholder="e.g. They asked to move to Thursday in their reply of 14:05"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-basis">
                How the time was agreed — required
              </Label>
              <Textarea
                id="bk-basis"
                value={basis}
                rows={2}
                maxLength={300}
                placeholder="e.g. They replied Tue 14 Oct 14:30 works — reply of 10:12"
                onChange={(event) => setBasis(event.target.value)}
              />
            </div>
          )}
          {startsAt.error !== null && date !== "" ? (
            <p className="text-xs text-destructive">{startsAt.error}</p>
          ) : null}
          {endsAt.error !== null && date !== "" && end !== "" ? (
            <p className="text-xs text-destructive">{endsAt.error}</p>
          ) : null}
        </div>

        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? <Spinner className="size-3.5" /> : null}
            {reschedule ? "Reschedule" : "Record the agreement"}
          </Button>
        </DialogFooter>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cancel a live booking — proposed or confirmed — with a required stated
 * reason. The agreed times stay on the record: cancelling records that the
 * agreement was called off, it does not erase that it existed. The operator
 * may set the follow-up the lead falls back to; left empty, the backend
 * derives the honest one.
 */
export function CancelBookingDialog({
  workspaceId,
  booking,
  expectedVersion,
  open,
  onOpenChange,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  expectedVersion: number
  open: boolean
  onOpenChange: (open: boolean) => void
  timezone: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {booking.state === "confirmed"
              ? "Cancel the booking"
              : "Cancel the proposal"}
          </DialogTitle>
          <DialogDescription>
            {booking.state === "confirmed"
              ? `The agreed time — ${booking.startsAt !== undefined && booking.timezone !== undefined ? formatInstant(booking.startsAt, booking.timezone) : "the meeting"} — is called off. Any unsent draft still offering it is retired in the same step. The record keeps the times and your reason.`
              : "The proposal is withdrawn — nothing it offered is still open. Any unsent draft carrying it is retired in the same step."}
          </DialogDescription>
        </DialogHeader>
        <CancelBookingForm
          workspaceId={workspaceId}
          booking={booking}
          expectedVersion={expectedVersion}
          onOpenChange={onOpenChange}
          timezone={timezone}
        />
      </DialogContent>
    </Dialog>
  )
}

function CancelBookingForm({
  workspaceId,
  booking,
  expectedVersion,
  onOpenChange,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  expectedVersion: number
  onOpenChange: (open: boolean) => void
  timezone: string
}) {
  const cancel = useMutation(api.bookings.cancel)
  const [requestId, rotateIntent] = useIntentId()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (reason.trim() === "") {
      setError("Say why the booking is cancelled — the record keeps it.")
      return
    }
    setBusy(true)
    setError(null)
    void cancel({
      workspaceId,
      bookingId: booking._id,
      expectedVersion,
      reason: reason.trim(),
      requestId,
    })
      .then(() => {
        toast.add({ title: "Booking cancelled — the record keeps what was agreed", type: "success" })
        rotateIntent()
        onOpenChange(false)
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="flex flex-col gap-1">
          <Label htmlFor="bk-cancel-reason">Reason — required</Label>
          <Textarea
            id="bk-cancel-reason"
            value={reason}
            rows={3}
            maxLength={500}
            placeholder="e.g. They wrote back that the timing no longer works"
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Read in {timezone} — the cancellation and the follow-up action it
            sets both land on the lead's history.
          </p>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={submit}
          >
            {busy ? <Spinner className="size-3.5" /> : null}
            Cancel the booking
          </Button>
        </DialogFooter>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Outcome                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record how a confirmed meeting went — completed or no-show. Only available
 * after the scheduled start (the backend refuses earlier): you cannot report
 * on a meeting that has not happened. The booking row, the lead's stage and
 * the follow-up action all move in the same transaction.
 */
export function OutcomeDialog({
  workspaceId,
  booking,
  expectedVersion,
  open,
  onOpenChange,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  expectedVersion: number
  open: boolean
  onOpenChange: (open: boolean) => void
  timezone: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record the outcome</DialogTitle>
          <DialogDescription>
            The meeting at{" "}
            {booking.startsAt !== undefined && booking.timezone !== undefined
              ? formatInstant(booking.startsAt, booking.timezone)
              : "the agreed time"}{" "}
            has happened or not — record which. The lead's next action follows
            the outcome (follow-up after a meeting, rebooking after a
            no-show); the history keeps both.
          </DialogDescription>
        </DialogHeader>
        <OutcomeForm
          workspaceId={workspaceId}
          booking={booking}
          expectedVersion={expectedVersion}
          onOpenChange={onOpenChange}
          timezone={timezone}
        />
      </DialogContent>
    </Dialog>
  )
}

function OutcomeForm({
  workspaceId,
  booking,
  expectedVersion,
  onOpenChange,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  expectedVersion: number
  onOpenChange: (open: boolean) => void
  timezone: string
}) {
  const recordOutcome = useMutation(api.bookings.recordOutcome)
  const [requestId, rotateIntent] = useIntentId()
  const [outcome, setOutcome] = useState<"completed" | "no_show">("completed")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setBusy(true)
    setError(null)
    void recordOutcome({
      workspaceId,
      bookingId: booking._id,
      expectedVersion,
      outcome,
      requestId,
    })
      .then(() => {
        toast.add({
          title:
            outcome === "completed"
              ? "Meeting recorded as completed"
              : "Meeting recorded as a no-show",
          type: "success",
        })
        rotateIntent()
        onOpenChange(false)
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="flex flex-col gap-1">
          <Label htmlFor="bk-outcome">How it went</Label>
          <NativeSelect
            id="bk-outcome"
            value={outcome}
            onChange={(event) =>
              setOutcome(event.target.value as "completed" | "no_show")
            }
          >
            <option value="completed">Completed — the meeting happened</option>
            <option value="no_show">No-show — they did not come</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {timezone} — an outcome after the fact is still an honest record;
            a state change it implies lands in the lead's history.
          </p>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? <Spinner className="size-3.5" /> : null}
            Record the outcome
          </Button>
        </DialogFooter>
    </>
  )
}
