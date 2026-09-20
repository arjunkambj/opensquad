/**
 * Step 2 of the connect flow: which mailbox this workspace sends from
 * (PLAN §4 "Manage inbox" step 2).
 *
 * Either an inbox that already exists on the pasted key's account, or a new
 * one the provider creates from a username. An account with no inboxes yet
 * skips straight to the create form rather than showing an empty list.
 *
 * Presentational: the caller owns the action, the busy flag and the error.
 */
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
            ? `The account behind the key ending ${last4} has no inboxes yet — we will create one for you.`
            : `Inboxes on the account behind the key ending ${last4}. Replies to this address come back into OpenIntent.`}
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
            description="A fresh address on your AgentMail account, used only for this outreach."
          />
        </div>
      ) : null}

      {creating ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
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
              The part before the @. AgentMail supplies the domain.
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
              What recipients see as the sender name.
            </FieldDescription>
          </Field>
        </div>
      ) : null}

      <FormError message={error} />

      <div className="flex items-center gap-2">
        <Button type="submit" size="cta" disabled={busy || !canSubmit}>
          {creating ? "Create and connect" : "Connect inbox"}
          {busy ? <Spinner className="size-4" /> : null}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="cta"
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
