import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WEEKDAYS } from "@/lib/workspace-time"

export type SendPolicyValues = {
  /** IANA weekday integers, 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  /** input[type=time] "HH:MM" values. */
  startTime: string
  endTime: string
  dailySendLimit: string
}

/**
 * Weekday picker + send window + daily limit inputs shared by onboarding and
 * workspace settings. Pure controlled fields — parsing/validation happens in
 * the parent before the backend call (which re-validates authoritatively).
 */
export function SendPolicyFields({
  values,
  onChange,
  disabled = false,
}: {
  values: SendPolicyValues
  onChange: (next: SendPolicyValues) => void
  disabled?: boolean
}) {
  const weekdayValues = values.weekdays.map(String)
  return (
    <>
      <Field>
        <FieldLabel>Sending days</FieldLabel>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          disabled={disabled}
          value={weekdayValues}
          onValueChange={(next) =>
            onChange({
              ...values,
              weekdays: next.map(Number).sort((a, b) => a - b),
            })
          }
        >
          {WEEKDAYS.map((day) => (
            <ToggleGroupItem
              key={day.value}
              value={String(day.value)}
              aria-label={day.long}
            >
              {day.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>
          Days the agent may send approved email, in the workspace timezone.
        </FieldDescription>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="send-window-start">Window start</FieldLabel>
          <Input
            id="send-window-start"
            type="time"
            disabled={disabled}
            value={values.startTime}
            onChange={(event) =>
              onChange({ ...values, startTime: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="send-window-end">Window end</FieldLabel>
          <Input
            id="send-window-end"
            type="time"
            disabled={disabled}
            value={values.endTime}
            onChange={(event) =>
              onChange({ ...values, endTime: event.target.value })
            }
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="daily-send-limit">Daily send limit</FieldLabel>
        <Input
          id="daily-send-limit"
          type="number"
          min={1}
          max={1000}
          step={1}
          disabled={disabled}
          value={values.dailySendLimit}
          onChange={(event) =>
            onChange({ ...values, dailySendLimit: event.target.value })
          }
        />
        <FieldDescription>
          Maximum approved sends per local day (1–1000).
        </FieldDescription>
      </Field>
    </>
  )
}
