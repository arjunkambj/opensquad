/**
 * "Mark as booked" — the ONE place a meeting becomes real (PLAN §9.5).
 *
 * `bookings.confirmations.confirm` records an agreement, so it asks for the
 * agreement: the time the two of them settled on, the zone that time was
 * stated in, and a one-line basis for it. It refuses a past meeting — that is
 * an outcome to record, not a confirmation.
 *
 * `confirm` can only advance a live proposal, so a lead that holds none gets
 * one for exactly the agreed slot first. Both calls carry a stable request id,
 * so a double submit records one meeting.
 */
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
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
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import { useIntentId } from "@/lib/use-intent-id"

const DURATIONS = [15, 30, 45, 60, 90] as const

export function MarkAsBookedDialog({
  orgId,
  prospectId,
  conversationId,
  existingProposal,
  open,
  onOpenChange,
}: {
  orgId: Id<"orgs">
  prospectId: Id<"prospects">
  conversationId: Id<"conversations">
  /** The lead's live proposal, when it already has one. */
  existingProposal: Doc<"bookings"> | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const propose = useMutation(api.bookings.proposals.propose)
  const confirm = useMutation(api.bookings.confirmations.confirm)
  const [intentId] = useIntentId()

  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [minutes, setMinutes] = useState<number>(30)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The person types the time they agreed, in their own zone, and that zone
  // is what gets recorded — it is the zone the meeting was stated in.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const startsAt =
    date === "" || time === "" ? Number.NaN : new Date(`${date}T${time}`).getTime()
  const complete = Number.isFinite(startsAt) && note.trim().length > 0

  const submit = () => {
    if (!complete || busy) {
      return
    }
    // Read the clock at the click, not during render. `confirm` refuses a
    // meeting that has already finished — saying so here beats a round trip.
    if (startsAt <= Date.now()) {
      setError(
        "A booked meeting is one still to come. For a meeting that already happened, record its outcome on the lead instead.",
      )
      return
    }
    setBusy(true)
    setError(null)
    const endsAt = startsAt + minutes * 60_000
    const ensureProposal =
      existingProposal !== null
        ? Promise.resolve(existingProposal)
        : propose({
            orgId,
            prospectId,
            conversationId,
            proposal: {
              kind: "slots" as const,
              timezone: zone,
              slots: [{ startsAt, endsAt }],
            },
            requestId: `${intentId}-propose`,
          })
    void ensureProposal
      .then((booking) =>
        confirm({
          orgId,
          bookingId: booking._id,
          expectedVersion: booking.version,
          startsAt,
          endsAt,
          timezone: zone,
          confirmationNote: note.trim(),
          requestId: `${intentId}-confirm`,
        }),
      )
      .then(() => {
        onOpenChange(false)
        toast.add({
          title: "Meeting booked",
          description: "The lead now shows as a booked meeting.",
          type: "success",
        })
      })
      .catch((cause) =>
        setError(errorMessage(cause, "Could not record that meeting.")),
      )
      .finally(() => setBusy(false))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark as booked</DialogTitle>
          <DialogDescription>
            Record the meeting you actually agreed. Times are in {zone}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-36 flex-1 flex-col gap-2">
              <Label htmlFor="booking-date">Date</Label>
              <Input
                id="booking-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="flex min-w-28 flex-1 flex-col gap-2">
              <Label htmlFor="booking-time">Start time</Label>
              <Input
                id="booking-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
            <div className="flex min-w-28 flex-1 flex-col gap-2">
              <Label htmlFor="booking-length">Length</Label>
              <NativeSelect
                id="booking-length"
                value={String(minutes)}
                onChange={(event) => setMinutes(Number(event.target.value))}
              >
                {DURATIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-note">How was it agreed?</Label>
            <Input
              id="booking-note"
              value={note}
              placeholder="They confirmed Tuesday 3pm by email"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={busy || !complete} onClick={submit}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Mark as booked
          </Button>
        </DialogFooter>
        {complete ? null : (
          <p role="status" className="text-xs text-muted-foreground">
            A booked meeting needs a date and time still to come, and one line
            saying how it was agreed.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
