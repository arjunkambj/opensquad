import { useUser } from "@hexclave/react"
import { Navigate, createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"
import { SignInForm } from "@/components/auth/SignInForm"
import { AuthLayout } from "@/components/Layout/AuthLayout"
import { Spinner } from "@/components/ui/spinner"

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
})

function SignInPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<Spinner className="mx-auto" />}>
        <SignInGate />
      </Suspense>
    </AuthLayout>
  )
}

function SignInGate() {
  const user = useUser()

  if (user) {
    return <Navigate to="/overview" />
  }

  return <SignInForm />
}
