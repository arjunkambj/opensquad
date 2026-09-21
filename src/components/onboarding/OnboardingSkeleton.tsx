/** Mirrors `OnboardingShell` in its aside layout, the one the first step (company) renders. */
import Logo from "@/components/layout/Logo"
// Not `ONBOARDING_DOT_COUNT`: onboarding-model imports the steps, which import this file.
import { ONBOARDING_STAGE_LABELS } from "@/components/onboarding/onboarding-stages"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function OnboardingSkeleton({
  label = "Loading your setup",
}: {
  label?: string
}) {
  const footer = (
    <div className="flex items-start justify-between gap-4">
      <div />
      <Skeleton shape="xl" className="h-8 w-28" />
    </div>
  )

  return (
    <SkeletonRegion
      label={label}
      className="min-h-svh w-full items-center gap-0 bg-linear-to-br from-background via-background to-section-accent/20 px-4 py-10 sm:px-6"
    >
      <div className="flex justify-center">
        <Logo markClassName="size-8" />
      </div>

      <StepperSkeleton />

      <div className="mt-12 grid w-full max-w-6xl gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-20">
        <div className="flex min-w-0 flex-col gap-8">
          <div>
            <TextLine className="mb-3 w-32" />
            <div className="flex flex-col gap-2">
              <TextLine size="title" className="w-80" />
              <TextLine className="w-64" />
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <TextLine className="w-16" />
              <Skeleton shape="xl" className="h-8 w-full" />
              <TextLine size="xs" className="w-72" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton shape="lg" className="h-5 w-8" />
              <TextLine className="w-40" />
            </div>
          </div>

          <div className="max-lg:hidden">{footer}</div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <TextLine size="lg" className="w-40" />
          <div className="flex flex-col gap-8">
            <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2">
              <FieldLine />
              <FieldLine />
            </div>
            <FieldLine tall />
            <FieldLine />
            <FieldLine />
          </div>
        </div>

        <div className="lg:hidden">{footer}</div>
      </div>
    </SkeletonRegion>
  )
}

/** Same dot and connector sizes as `OnboardingStepper`. */
function StepperSkeleton() {
  return (
    <div className="mt-8 flex items-center justify-center">
      {Array.from({ length: ONBOARDING_STAGE_LABELS.length }, (_, index) => (
        <div className="flex items-center" key={index}>
          {index > 0 ? (
            <span className="mx-1 block h-px w-10 shrink-0 bg-border sm:w-20" />
          ) : null}
          <Skeleton shape="full" className="size-9 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** A line of text: the box is the real line height, the pulse sits inside it.
 * `xs`, `sm`, `lg` and `title` follow the type sizes the onboarding screens use. */
export function TextLine({
  size = "sm",
  className,
}: {
  size?: "xs" | "sm" | "lg" | "title"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center",
        size === "xs" && "h-4",
        size === "sm" && "h-5",
        size === "lg" && "h-7",
        size === "title" && "h-8 sm:h-9",
        className,
      )}
    >
      <Skeleton
        shape="full"
        className={cn(
          "w-full",
          size === "xs" && "h-3",
          size === "sm" && "h-3.5",
          size === "lg" && "h-5",
          size === "title" && "h-6 sm:h-7",
        )}
      />
    </div>
  )
}

function FieldLine({ tall = false }: { tall?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <TextLine className="w-28" />
      <Skeleton className={tall ? "h-24 w-full" : "h-8 w-full"} />
    </div>
  )
}
