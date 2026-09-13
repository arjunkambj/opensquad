import { ConvexError } from "convex/values"

/**
 * Domain error codes thrown by the OpenSquad backend via
 * `domainError`/`invalid` in `convex/lib/validators.ts`.
 */
export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"

const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID",
]

type DomainErrorData = {
  code?: unknown
  message?: unknown
}

function domainErrorData(error: unknown): DomainErrorData | undefined {
  if (error instanceof ConvexError) {
    const data: unknown = error.data
    if (typeof data === "object" && data !== null) {
      return data as DomainErrorData
    }
  }
  return undefined
}

/** The backend domain code, when the error is one of ours. */
export function domainErrorCode(error: unknown): DomainErrorCode | undefined {
  const code = domainErrorData(error)?.code
  if (
    typeof code === "string" &&
    DOMAIN_ERROR_CODES.includes(code as DomainErrorCode)
  ) {
    return code as DomainErrorCode
  }
  return undefined
}

/** True when the mutation failed because the expected version was stale. */
export function isConflictError(error: unknown): boolean {
  return domainErrorCode(error) === "CONFLICT"
}

/**
 * Human-readable message for a failed call. Prefers the backend's domain
 * message; falls back to the Error text and finally a generic fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
  const message = domainErrorData(error)?.message
  if (typeof message === "string" && message.length > 0) {
    return message
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return fallback
}
