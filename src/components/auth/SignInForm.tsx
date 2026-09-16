import {
  EyeIcon,
  EyeOffIcon,
  LockPasswordIcon,
  Mail01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHexclaveApp } from "@hexclave/react"
import { useEffect, useRef, useState } from "react"
import { GoogleMark } from "@/components/auth/GoogleMark"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"

type AuthMethod = "code" | "password"

export function SignInForm() {
  const app = useHexclaveApp()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authMethod, setAuthMethod] = useState<AuthMethod>("code")
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [step, setStep] = useState<"email" | "otp">("email")
  const [nonce, setNonce] = useState("")
  const [otp, setOtp] = useState("")
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [isEmailLoading, setIsEmailLoading] = useState(false)
  const [isPasswordLoading, setIsPasswordLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const verificationPending = useRef(false)

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
      setIsGoogleLoading(false)
    }
  }

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

  const handlePasswordSignIn = async () => {
    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) {
      toast.add({
        type: "error",
        title: "Please enter your email and password.",
      })
      return
    }

    setIsPasswordLoading(true)

    try {
      const result = await app.signInWithCredential({
        email: normalizedEmail,
        password,
      })
      if (result.status === "error") {
        toast.add({
          type: "error",
          title: "Could not sign in. Check your email and password.",
        })
      }
    } catch {
      toast.add({
        type: "error",
        title: "Something went wrong. Please try again.",
      })
    } finally {
      setIsPasswordLoading(false)
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

  const isSubmitting = isEmailLoading || isPasswordLoading

  return (
    <div className="mx-auto flex w-full flex-col gap-6 sm:max-w-sm">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Welcome to OpenSquad
        </h1>
        <p className="mt-2 text-sm font-light text-muted-foreground">
          {step === "email"
            ? "Choose how you want to continue"
            : `We sent a code to ${email}`}
        </p>
      </div>

      {step === "email" ? (
        <div className="flex flex-col gap-4">
          <Button
            className="border-border bg-background text-foreground shadow-[0_1px_1px_rgba(0,0,0,0.03),0_4px_12px_-6px_rgba(0,0,0,0.06)] hover:bg-background hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-6px_rgba(0,0,0,0.08)]"
            type="button"
            variant="outline"
            size="lg"
            disabled={isGoogleLoading}
            onClick={() => void handleGoogleSignIn()}
          >
            {isGoogleLoading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <GoogleMark className="size-4" data-icon="inline-start" />
            )}
            {isGoogleLoading ? "Redirecting..." : "Continue with Google"}
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Tabs
            value={authMethod}
            onValueChange={(value) => setAuthMethod(value as AuthMethod)}
            className="w-full"
          >
            <TabsList
              aria-label="Email sign-in method"
              className="w-full group-data-horizontal/tabs:h-9"
            >
              <TabsTrigger value="code">Email code</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
            </TabsList>
          </Tabs>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (authMethod === "password") {
                void handlePasswordSignIn()
              } else {
                void handleSendMagicLink("initial")
              }
            }}
          >
            <div className="flex flex-col gap-3">
              <InputGroup className="h-9">
                <InputGroupAddon>
                  <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Email address"
                  autoComplete="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </InputGroup>

              {authMethod === "password" ? (
                <InputGroup className="h-9">
                  <InputGroupAddon>
                    <HugeiconsIcon icon={LockPasswordIcon} strokeWidth={2} />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Password"
                    autoComplete="current-password"
                    type={isPasswordVisible ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={
                        isPasswordVisible ? "Hide password" : "Show password"
                      }
                      aria-pressed={isPasswordVisible}
                      onClick={() => setIsPasswordVisible((visible) => !visible)}
                    >
                      <HugeiconsIcon
                        icon={isPasswordVisible ? EyeOffIcon : EyeIcon}
                        strokeWidth={2}
                      />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : null}
            </div>

            {authMethod === "password" ? (
              <a
                href={app.urls.forgotPassword}
                className="-mt-1 self-end rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
              >
                Forgot password?
              </a>
            ) : (
              <p className="-mt-1 text-xs leading-5 text-muted-foreground">
                We will email you a one-time sign-in code.
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              {authMethod === "password"
                ? isPasswordLoading
                  ? "Signing in..."
                  : "Sign in"
                : isEmailLoading
                  ? "Sending..."
                  : "Send sign-in code"}
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 pt-1">
          <p className="text-center text-sm font-light text-muted-foreground">
            Enter the 6-character code from your email
          </p>
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={(value) => setOtp(value.toUpperCase())}
            disabled={isVerifying}
            containerClassName="w-full justify-center"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="size-10" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {isVerifying ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-3.5" />
              Verifying...
            </div>
          ) : null}
          <div className="flex flex-col items-center gap-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : "Didn't get the code?"}
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={isEmailLoading || resendCooldown > 0}
                onClick={() => void handleSendMagicLink("resend")}
                className="inline-flex items-center gap-1.5 font-medium disabled:opacity-60"
              >
                {isEmailLoading ? <Spinner className="size-3.5" /> : null}
                {isEmailLoading ? "Sending..." : "Resend code"}
              </button>
              <span className="text-muted-foreground">|</span>
              <button
                type="button"
                onClick={() => {
                  setStep("email")
                  setOtp("")
                  setNonce("")
                  setResendCooldown(0)
                }}
                className="font-medium"
              >
                Use a different email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
