import { useState } from "react"
import { RadioCard } from "@/components/kit/RadioCard"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { VerifiedInbox } from "./inbox-connection-model"
import { normalizeUsername } from "./inbox-connection-model"

/** The "make me one" choice, kept apart from any real inbox id. */
const NEW_INBOX = "__new_inbox__"

export type InboxChoice =
  | { kind: "existing"; inboxId: string }
  | { kind: "new"; username: string; displayName: string }

export function InboxPicker({
  inboxes,
  last4,
  busy,
  busyNote,
  error,
  onConnect,
  onBack,
}: {
  inboxes: readonly VerifiedInbox[]
  /** Last four of the key that listed these, so the user sees which account. */
  last4: string
  busy: boolean
  /** What the pending request is doing, while it runs. */
  busyNote?: string
  error: string | null
  onConnect: (choice: InboxChoice) => void
  onBack: () => void
}) {
  const [selected, setSelected] = useState<string>(
    inboxes.length > 0 ? (inboxes[0]?.inboxId ?? NEW_INBOX) : NEW_INBOX,
  )
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")

  const creating = selected === NEW_INBOX
  const canSubmit = creating ? normalizeUsername(username).length > 0 : true

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || !canSubmit) {
          return
        }
        onConnect(
          creating
            ? {
                kind: "new",
                username: normalizeUsername(username),
                displayName: displayName.trim(),
              }
            : { kind: "existing", inboxId: selected },
        )
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">
          Choose the inbox to send from
        </p>
        <p className="text-sm text-muted-foreground">
          {inboxes.length === 0
            ? "No inboxes yet. Create one below."
            : `Key ending ${last4}.`}
        </p>
      </div>

      {inboxes.length > 0 ? (
        <div className="flex flex-col gap-2">
          {inboxes.map((inbox) => (
            <RadioCard
              key={inbox.inboxId}
              name="sending-inbox"
              value={inbox.inboxId}
              checked={selected === inbox.inboxId}
              onSelect={setSelected}
              disabled={busy}
              title={inbox.address}
              {...(inbox.displayName !== undefined
                ? { description: inbox.displayName }
                : {})}
            />
          ))}
          <RadioCard
            name="sending-inbox"
            value={NEW_INBOX}
            checked={creating}
            onSelect={setSelected}
            disabled={busy}
            title="Create a new inbox"
            description="A new address for outreach."
          />
        </div>
      ) : null}

      {creating ? (
        <div className="flex flex-col gap-4 rounded-2xl bg-card p-4">
          <Field>
            <FieldLabel htmlFor="inbox-username">Username</FieldLabel>
            <Input
              id="inbox-username"
              value={username}
              disabled={busy}
              autoComplete="off"
              placeholder="hello"
              onChange={(event) => {
                setUsername(event.target.value)
              }}
            />
            <FieldDescription>
              The part before the @.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="inbox-display-name">
              Display name (optional)
            </FieldLabel>
            <Input
              id="inbox-display-name"
              value={displayName}
              disabled={busy}
              autoComplete="off"
              placeholder="Your name or team"
              onChange={(event) => {
                setDisplayName(event.target.value)
              }}
            />
            <FieldDescription>
              Shown as the sender.
            </FieldDescription>
          </Field>
        </div>
      ) : null}

      <FormError message={error} />

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !canSubmit}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {creating ? "Create and connect" : "Connect inbox"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onBack}
        >
          Use a different key
        </Button>
      </div>

      {busy && busyNote !== undefined ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {busyNote}
        </p>
      ) : null}
    </form>
  )
}
