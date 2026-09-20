/**
 * Auth — the sign-in screen and the gate that sends a signed-in visitor on.
 *
 * Identity itself belongs to Hexclave; nothing here stores a credential.
 */
import { Suspense } from "react"
import { SignInGate } from "@/components/auth/SignInGate"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Spinner } from "@/components/ui/spinner"

/** The sign-in screen: the auth shell around the gate. */
export function SignInPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<Spinner className="mx-auto" />}>
        <SignInGate />
      </Suspense>
    </AuthLayout>
  )
}
