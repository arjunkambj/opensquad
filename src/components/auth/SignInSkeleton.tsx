/** Mirrors the email step of `SignInForm`, the first thing a signed-out visitor sees. */
import { SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

export function SignInSkeleton({ label = "Loading sign-in" }: { label?: string }) {
  return (
    <SkeletonRegion label={label} className="mx-auto w-full sm:max-w-sm">
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-64 max-w-full items-center">
          <Skeleton shape="full" className="h-6 w-full" />
        </div>
        <div className="mt-2 flex h-5 w-48 items-center">
          <Skeleton shape="full" className="h-3.5 w-full" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton shape="xl" className="h-8 w-full" />

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <Skeleton shape="full" className="h-3 w-4" />
          <span className="h-px flex-1 bg-border" />
        </div>

        <Skeleton shape="xl" className="h-8 w-full" />

        <div className="flex flex-col gap-4">
          <Skeleton shape="xl" className="h-8 w-full" />
          <div className="-mt-1 flex h-5 w-56 items-center">
            <Skeleton shape="full" className="h-3 w-full" />
          </div>
          <Skeleton shape="xl" className="h-8 w-full" />
        </div>
      </div>
    </SkeletonRegion>
  )
}
