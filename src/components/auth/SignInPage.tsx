import { Suspense } from "react"
import { SignInGate } from "@/components/auth/SignInGate"
import { SignInSkeleton } from "@/components/auth/SignInSkeleton"
import { AuthLayout } from "@/components/layout/AuthLayout"

export function SignInPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<SignInSkeleton />}>
        <SignInGate />
      </Suspense>
    </AuthLayout>
  )
}
