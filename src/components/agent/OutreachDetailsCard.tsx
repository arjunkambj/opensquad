/**
 * The two practical settings behind every email the agent writes: the link it
 * may offer when someone wants to meet, and how often it follows up while
 * nobody answers.
 *
 * Both are saved explicitly and neither moves `agents.revision` — they change
 * what a future email contains, not what a queued one says, so nothing
 * already written is invalidated by editing them.
 */
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { AgentDoc } from "./agent-model"
import { agentErrorCopy, followUpSummary } from "./agent-model"

/**
 * The follow-up ladders offered. A free-form list of days would be a second
 * scheduling UI for a decision with three sensible answers; the backend still
 * validates whatever arrives (1–3 ascending days).
 */
const FOLLOW_UP_CHOICES: readonly { id: string; days: number[] }[] = [
  { id: "none", days: [] },
  { id: "3", days: [3] },
  { id: "3-7", days: [3, 7] },
  { id: "2-5-10", days: [2, 5, 10] },
]

function choiceIdOf(days: readonly number[]): string {
  const key = days.join("-")
  return (
    FOLLOW_UP_CHOICES.find((choice) => choice.days.join("-") === key)?.id ??
    "custom"
  )
}

export function OutreachDetailsCard({ agent }: { agent: AgentDoc }) {
  const setBookingUrl = useMutation(api.agents.settings.setBookingUrl)
  const setFollowUpDays = useMutation(api.agents.settings.setFollowUpDays)
  const stored = agent.bookingUrl ?? ""
  const [draft, setDraft] = useState(stored)
  const [syncedWith, setSyncedWith] = useState(stored)
  const [saving, setSaving] = useState<"booking" | "followUps" | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (stored !== syncedWith && draft === syncedWith) {
    setSyncedWith(stored)
    setDraft(stored)
  }

  const currentChoice = choiceIdOf(agent.followUpDays)

  const saveBooking = async () => {
    setSaving("booking")
    setError(null)
    try {
      await setBookingUrl({
        orgId: agent.orgId,
        agentId: agent._id,
        bookingUrl: draft.trim() === "" ? null : draft,
      })
      setSyncedWith(draft)
      toast.add({ title: "Booking link saved", type: "success" })
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not save the booking link."))
    } finally {
      setSaving(null)
    }
  }

  const saveFollowUps = async (id: string) => {
    const choice = FOLLOW_UP_CHOICES.find((entry) => entry.id === id)
    if (choice === undefined) {
      return
    }
    setSaving("followUps")
    setError(null)
    try {
      await setFollowUpDays({
        orgId: agent.orgId,
        agentId: agent._id,
        followUpDays: choice.days,
      })
      toast.add({ title: "Follow-ups saved", type: "success" })
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not save the follow-up schedule."))
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meetings and follow-ups</CardTitle>
        <CardDescription>
          What the agent offers when someone wants to talk, and how long it
          keeps trying when nobody answers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="agent-booking-url">Booking link</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="agent-booking-url"
              type="url"
              inputMode="url"
              className="max-w-md"
              disabled={saving !== null}
              value={draft}
              placeholder="https://cal.com/you/30min"
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={draft === stored || saving !== null}
              onClick={() => void saveBooking()}
            >
              {saving === "booking" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Save link
            </Button>
          </div>
          <FieldDescription>
            Leave it empty and the agent proposes times in words instead. A
            meeting only counts once you mark it as booked.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-follow-ups">Follow-ups</FieldLabel>
          <NativeSelect
            id="agent-follow-ups"
            className="max-w-md"
            disabled={saving !== null}
            value={currentChoice}
            onChange={(event) => void saveFollowUps(event.target.value)}
          >
            {currentChoice === "custom" ? (
              <option value="custom">
                {agent.followUpDays.join(", ")} days after the previous email
              </option>
            ) : null}
            {FOLLOW_UP_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.days.length === 0
                  ? "No follow-ups"
                  : `After ${choice.days.join(", then ")} days`}
              </option>
            ))}
          </NativeSelect>
          <FieldDescription>
            {followUpSummary(agent.followUpDays)} A reply stops them.
          </FieldDescription>
        </Field>

        <FormError message={error} />
      </CardContent>
    </Card>
  )
}
