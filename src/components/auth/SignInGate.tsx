import { useUser } from "@hexclave/react"
import { Navigate, useNavigate, useSearch } from "@tanstack/react-router"
import { useEffect } from "react"
import { SignInForm } from "@/components/auth/SignInForm"
import { Spinner } from "@/components/ui/spinner"

/**
 * Sends an already-signed-in visitor on, and shows the form to everyone else.
 */
export function SignInGate() {
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
    // No return path means the signed-in home — `/leads`, not Overview,
    // which is a deliberate step from the CRM's top bar.
    return after_auth_return_to === undefined ? (
      <Navigate to="/leads" replace />
    ) : (
      <Spinner className="mx-auto" />
    )
  }

  return <SignInForm />
}
