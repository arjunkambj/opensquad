import { Suspense } from "react"
import { SignInGate } from "@/components/auth/SignInGate"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Spinner } from "@/components/ui/spinner"

export function SignInPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<Spinner className="mx-auto" />}>
        <SignInGate />
      </Suspense>
    </AuthLayout>
  )
}
