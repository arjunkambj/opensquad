import { GoogleIcon, Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHexclaveApp } from "@hexclave/react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"

export function SignInForm() {
  const app = useHexclaveApp()

  const [email, setEmail] = useState("")
  const [step, setStep] = useState<"email" | "otp">("email")
  const [nonce, setNonce] = useState("")
  const [otp, setOtp] = useState("")
  const [isEmailLoading, setIsEmailLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const verificationPending = useRef(false)

  const handleSendMagicLink = async (
    source: "initial" | "resend" = "initial",
  ) => {
    if (source === "resend" && resendCooldown > 0) {
      return
    }

    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      toast.add({
        type: "error",
        title: "Please enter your email address.",
      })
      return
    }

    setIsEmailLoading(true)

    try {
      const result = await app.sendMagicLinkEmail(normalizedEmail, {
        callbackUrl: `${window.location.origin}${app.urls.magicLinkCallback}`,
      })
      if (result.status === "error") {
        toast.add({
          type: "error",
          title: "Could not send verification code. Please try again.",
        })
      } else {
        setEmail(normalizedEmail)
        setNonce(result.data.nonce)
        setOtp("")
        setStep("otp")
        setResendCooldown(20)
        toast.add({
          type: "success",
          title: "Verification code sent. Check your email.",
        })
      }
    } catch {
      toast.add({
        type: "error",
        title: "Something went wrong. Please try again.",
      })
    } finally {
      setIsEmailLoading(false)
    }
  }

  useEffect(() => {
    if (step !== "otp" || resendCooldown <= 0) return

    const timer = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(current - 1, 0))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [step, resendCooldown])

  useEffect(() => {
    if (otp.length !== 6 || verificationPending.current) return
    verificationPending.current = true
    let cancelled = false

    const verify = async () => {
      setIsVerifying(true)
      try {
        const result = await app.signInWithMagicLink(otp + nonce)
        if (!cancelled && result.status === "error") {
          toast.add({
            type: "error",
            title: "Invalid code. Please try again.",
          })
        }
      } catch {
        if (!cancelled) {
          toast.add({
            type: "error",
            title: "Something went wrong. Please try again.",
          })
        }
      } finally {
        if (!cancelled) {
          setOtp("")
          setIsVerifying(false)
        }
        verificationPending.current = false
      }
    }

    void verify()
    return () => {
      cancelled = true
    }
  }, [app, nonce, otp])

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)
    try {
      await app.signInWithOAuth("google", {
        returnTo: app.urls.afterSignIn,
      })
    } catch {
      toast.add({
        type: "error",
        title: "Could not continue with Google. Please try again.",
      })
    } finally {
      setIsGoogleLoading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
          Welcome to OpenSquad
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {step === "email"
            ? "Sign in to plan and ship together"
            : `We sent a code to ${email}`}
        </p>
      </div>

      {step === "email" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSendMagicLink("initial")
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="email" className="sr-only">
                Email
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <HugeiconsIcon icon={Mail01Icon} />
                </InputGroupAddon>
                <InputGroupInput
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                />
              </InputGroup>
            </Field>
            <Button type="submit" disabled={isEmailLoading} size="lg">
              {isEmailLoading ? <Spinner data-icon="inline-start" /> : null}
              Continue with Email
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-5 pt-1">
          <p className="text-center text-sm text-muted-foreground">
            Enter the 6-character code from your email
          </p>
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={(value) => setOtp(value.toUpperCase())}
            disabled={isVerifying}
            containerClassName="justify-center gap-2"
          >
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {isVerifying ? (
            <Skeleton className="h-5 w-32" aria-label="Verifying..." />
          ) : null}
          <div className="flex flex-col items-center gap-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : "Didn't get the code?"}
            </p>
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="link"
                disabled={isEmailLoading || resendCooldown > 0}
                onClick={() => void handleSendMagicLink("resend")}
              >
                {isEmailLoading ? "Sending..." : "Resend code"}
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  setStep("email")
                  setOtp("")
                  setNonce("")
                  setResendCooldown(0)
                }}
              >
                Use a different email
              </Button>
            </div>
          </div>
        </div>
      )}

      <FieldSeparator>OR</FieldSeparator>

      <Button
        variant="secondary"
        disabled={isGoogleLoading}
        size="lg"
        onClick={() => void handleGoogleSignIn()}
      >
        {isGoogleLoading ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <HugeiconsIcon icon={GoogleIcon} data-icon="inline-start" />
        )}
        Continue with Google
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} OpenSquad. All rights reserved.
      </p>
    </div>
  )
}
