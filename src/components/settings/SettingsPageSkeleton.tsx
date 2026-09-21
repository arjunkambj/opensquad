import { SettingsTabSkeleton } from "@/components/settings/SettingsTabSkeletons"
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
} from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `SettingsPage`: the section nav beside a max-w-3xl column. */
export function SettingsPageSkeleton({
  tab = DEFAULT_SETTINGS_TAB,
}: {
  tab?: SettingsTab
}) {
  return (
    <SkeletonRegion
      label="Loading settings"
      className="md:flex-row md:gap-12"
    >
      <div className="md:w-52 md:shrink-0">
        <SettingsTabBarSkeleton />
      </div>
      <div className="flex max-w-3xl min-w-0 flex-1 flex-col gap-6">
        <PageTitleSkeleton />
        <SettingsTabSkeleton tab={tab} />
      </div>
    </SkeletonRegion>
  )
}

/** Mirrors `SettingsTabBar`: a vertical list on wide screens, a row on narrow ones. */
function SettingsTabBarSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden h-4 items-center px-3 md:flex">
        <Skeleton shape="full" className="h-3 w-16" />
      </div>
      <div className="-mx-1 flex gap-0.5 overflow-hidden px-1 md:mx-0 md:flex-col md:px-0">
        {SETTINGS_TABS.map((value) => (
          <div key={value} className="flex h-7.5 shrink-0 items-center px-3">
            <Skeleton shape="full" className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
