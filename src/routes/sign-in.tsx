import { createFileRoute } from "@tanstack/react-router"
import { SignInPage } from "@/components/auth/SignInPage"

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
    // `/sign-in?after_auth_return_to=/dashboard`. An already-signed-in visitor
    // should honor it rather than land on the default destination.
    after_auth_return_to: internalPath(search.after_auth_return_to),
  }),
  component: SignInPage,
})
