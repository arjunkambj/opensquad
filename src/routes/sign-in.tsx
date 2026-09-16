import { useUser } from "@hexclave/react"
import {
  Navigate,
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router"
import { Suspense, useEffect } from "react"
import { SignInForm } from "@/components/auth/SignInForm"
import { AuthLayout } from "@/components/Layout/AuthLayout"
import { Spinner } from "@/components/ui/spinner"

/**
 * A same-origin path only — a `//` prefix or a scheme would turn the
 * post-sign-in hop into an open redirect.
 */
function internalPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return undefined
  }
  return value.startsWith("/") && !value.startsWith("//") ? value : undefined
}

export const Route = createFileRoute("/sign-in")({
  // The optional-key return type matters: a required key would make every
  // `<Link to="/sign-in">` demand a `search` prop.
  validateSearch: (search): { after_auth_return_to?: string } => ({
    // Hexclave appends this when it bounces a signed-out user here, e.g.
    // `/sign-in?after_auth_return_to=/overview`. An already-signed-in visitor
    // should honor it rather than land on the default destination.
    after_auth_return_to: internalPath(search.after_auth_return_to),
  }),
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
  const { after_auth_return_to } = useSearch({ from: "/sign-in" })
  const navigate = useNavigate()

  // `to` only accepts a registered route literal, so the caller's return path
  // goes through `href` — it is already sanitised to a same-origin path by
  // `validateSearch`.
  useEffect(() => {
    if (user && after_auth_return_to !== undefined) {
      void navigate({ href: after_auth_return_to, replace: true })
    }
  }, [user, after_auth_return_to, navigate])

  if (user) {
    return after_auth_return_to === undefined ? (
      <Navigate to="/overview" replace />
    ) : (
      <Spinner className="mx-auto" />
    )
  }

  return <SignInForm />
}
