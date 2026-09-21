/** Right column of step one: the profile, as placeholders, a skeleton, or the form. */
import type { ReactNode } from "react"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type ProfilePanelState = "empty" | "reading" | "ready" | "manual"

export function ProfilePanel({
  state,
  children,
}: {
  state: ProfilePanelState
  /** The form, shown once there is something to edit. */
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        state === "empty" && "max-lg:hidden",
      )}
    >
      <div className="flex min-h-6 items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Company profile
        </h2>
        {state === "empty" ? (
          <p className="text-xs text-muted-foreground">
            Fills in from your website
          </p>
        ) : null}
        {state === "reading" ? (
          <span aria-live="polite" className="sr-only" role="status">
            Reading your website
          </span>
        ) : null}
        {state === "ready" ? (
          <AiGeneratedBadge label="Written from your website" />
        ) : null}
      </div>

      {state === "ready" || state === "manual" ? (
        children
      ) : (
        <ProfilePlaceholder pulse={state === "reading"} />
      )}
    </div>
  )
}

/** Mirrors the form's shape so the draft lands where the eye already is. */
function ProfilePlaceholder({ pulse }: { pulse: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2">
        <PlaceholderField label="Company name">
          <Block pulse={pulse} />
        </PlaceholderField>
        <PlaceholderField label="Industry">
          <Block pulse={pulse} />
        </PlaceholderField>
      </div>
      <PlaceholderField label="What you do">
        <Block pulse={pulse} tall />
      </PlaceholderField>
      <PlaceholderField label="Key features">
        <Block pulse={pulse} />
      </PlaceholderField>
      <PlaceholderField label="Social proof">
        <Block pulse={pulse} />
      </PlaceholderField>
    </div>
  )
}

function PlaceholderField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function Block({ pulse, tall = false }: { pulse: boolean; tall?: boolean }) {
  if (pulse) {
    return tall ? <Skeleton className="h-24" /> : <Skeleton className="h-8" />
  }
  return (
    <div
      className={cn("rounded-2xl bg-foreground/5", tall ? "h-24" : "h-8")}
    />
  )
}
