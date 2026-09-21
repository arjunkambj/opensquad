import { ConvexError } from "convex/values"
import { DOMAIN_ERROR_CODES } from "../../convex/lib/errors"
import type { DomainErrorCode } from "../../convex/lib/errors"

export type { DomainErrorCode }

const DOMAIN_ERROR_CODE_SET: ReadonlySet<string> = new Set(DOMAIN_ERROR_CODES)

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

export function domainErrorCode(error: unknown): DomainErrorCode | undefined {
  const code = domainErrorData(error)?.code
  return typeof code === "string" && DOMAIN_ERROR_CODE_SET.has(code)
    ? (code as DomainErrorCode)
    : undefined
}

export function isConflictError(error: unknown): boolean {
  return domainErrorCode(error) === "CONFLICT"
}

/** Malformed IDs fail Convex argument validation before the handler can return NOT_FOUND.
 * Only ID validation errors map to missing records; other argument errors remain visible. */
export function isMalformedIdError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("ArgumentValidationError") &&
    error.message.includes("Validator: v.id(")
  )
}

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
