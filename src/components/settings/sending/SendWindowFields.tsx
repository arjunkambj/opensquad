/**
 * The sending-window fields: timezone, days, hours and the daily ceiling.
 *
 * Presentational controlled fields — the card above parses and validates them
 * before the backend call, which re-validates authoritatively.
 *
 * The daily limit's max is the trial's real ceiling and the field says so:
 * the server clamps anything higher, and a control that accepts 200 and
 * silently stores 30 would be lying about what the agent will do.
 */
import { TRIAL_DAILY_SEND_LIMIT_MAX } from "../../../../convex/lib/prices"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { timezoneOptions, WEEKDAYS } from "@/lib/org-time"

export type SendWindowValues = {
  /** IANA timezone; the window and the daily boundary are evaluated in it. */
  timezone: string
  /** IANA weekday integers, 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  /** input[type=time] "HH:MM" values. */
  startTime: string
  endTime: string
  dailySendLimit: string
}

export function SendWindowFields({
  values,
  onChange,
  disabled = false,
}: {
  values: SendWindowValues
  onChange: (next: SendWindowValues) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor="sending-timezone">Timezone</FieldLabel>
        <NativeSelect
          disabled={disabled}
          id="sending-timezone"
          value={values.timezone}
          onChange={(event) =>
            onChange({ ...values, timezone: event.target.value })
          }
        >
          {timezoneOptions(values.timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription>
          Every day, hour and daily total below is read in this zone.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>Sending days</FieldLabel>
        <ToggleGroup
          disabled={disabled}
          multiple
          size="sm"
          value={values.weekdays.map(String)}
          variant="outline"
          onValueChange={(next) =>
            onChange({
              ...values,
              weekdays: next.map(Number).sort((a, b) => a - b),
            })
          }
        >
          {WEEKDAYS.map((day) => (
            <ToggleGroupItem
              aria-label={day.long}
              key={day.value}
              value={String(day.value)}
            >
              {day.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>
          Days your agent may send. Replies are received every day regardless.
        </FieldDescription>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="send-window-start">Window opens</FieldLabel>
          <Input
            disabled={disabled}
            id="send-window-start"
            type="time"
            value={values.startTime}
            onChange={(event) =>
              onChange({ ...values, startTime: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="send-window-end">Window closes</FieldLabel>
          <Input
            disabled={disabled}
            id="send-window-end"
            type="time"
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
          disabled={disabled}
          id="daily-send-limit"
          max={TRIAL_DAILY_SEND_LIMIT_MAX}
          min={1}
          step={1}
          type="number"
          value={values.dailySendLimit}
          onChange={(event) =>
            onChange({ ...values, dailySendLimit: event.target.value })
          }
        />
        <FieldDescription>
          Sends per local day, at most {TRIAL_DAILY_SEND_LIMIT_MAX}. That
          ceiling is the trial&rsquo;s, not a preference — a higher number is
          refused rather than quietly reduced.
        </FieldDescription>
      </Field>
    </div>
  )
}
