/**
 * "Verify your email to continue" — the one refusal with work to do on it.
 *
 * Your agent sends email on your behalf, so the address is confirmed before
 * anything is created. The screen owns the resend it offers and nothing else:
 * whether this state is the right one is `EntryRefusalState`'s call.
 */
import type { CurrentUser } from "@hexclave/react"
import { useState } from "react"
import { SetupFrame } from "@/components/onboarding/SetupFrame"
import { useMountedRef } from "@/hooks/use-mounted"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export function VerifyEmailRefusal({
  user,
  onRetry,
}: {
  user: CurrentUser
  /** The user says the address is verified now — ask for the org again. */
  onRetry: () => void
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const mounted = useMountedRef()

  const resend = async () => {
    setSending(true)
    setSendError(null)
    try {
      const channels = await user.listContactChannels()
      if (!mounted.current) {
        return
      }
      const target =
        channels.find((channel) => channel.isPrimary && !channel.isVerified) ??
        channels.find((channel) => !channel.isVerified)
      if (target === undefined) {
        // Nothing left to verify here — the token just has not caught up.
        onRetry()
        return
      }
      await target.sendVerificationEmail({ callbackUrl: window.location.href })
      if (mounted.current) {
        setSent(true)
      }
    } catch {
      if (mounted.current) {
        setSendError("We couldn't send that email. Try again in a moment.")
      }
    } finally {
      if (mounted.current) {
        setSending(false)
      }
    }
  }

  return (
    <SetupFrame>
      <EmptyState
        action={
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap justify-center gap-2">
              <Button disabled={sending} onClick={() => void resend()}>
                {sent ? "Send it again" : "Resend the email"}
              </Button>
              <Button onClick={onRetry} variant="outline">
                I&rsquo;ve verified it
              </Button>
            </div>
            {sent ? (
              <p className="text-sm text-muted-foreground">
                Sent. Open the link, then come back and continue.
              </p>
            ) : null}
            {sendError !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {sendError}
              </p>
            ) : null}
          </div>
        }
        description="Your agent sends email on your behalf, so we confirm the address is yours before anything is created. Open the link we sent you, then come back."
        title="Verify your email to continue"
      />
    </SetupFrame>
  )
}
