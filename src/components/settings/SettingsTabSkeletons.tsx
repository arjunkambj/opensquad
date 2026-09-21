/** Per-tab placeholders for Settings. Each mirrors its tab's sections and
 * fields, so the form does not shift when the record lands. */
import { BlocklistTableSkeleton } from "@/components/settings/blocklist/BlocklistTable"
import type { SettingsTab } from "@/components/settings/settings-model"
import {
  FieldSkeleton,
  SectionSkeleton,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

export function SettingsTabSkeleton({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "company":
      return <CompanyTabSkeleton />
    case "outreach":
      return <OutreachTabSkeleton />
    case "blocklist":
      return <BlocklistTabSkeleton />
    case "sending":
      return <SendingTabSkeleton />
    case "account":
      return <AccountTabSkeleton />
  }
}

/** A `FieldDescription` line under a field. */
function FieldNoteSkeleton() {
  return (
    <div className="flex h-5 items-center">
      <Skeleton shape="full" className="h-3.5 w-3/5" />
    </div>
  )
}

function SaveRowSkeleton({ note = false }: { note?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {note ? <Skeleton shape="full" className="mr-auto h-3.5 w-56" /> : null}
      <Skeleton shape="xl" className="h-8 w-32" />
    </div>
  )
}

/** Mirrors `CompanyTab`: the website field, then the profile form. */
export function CompanyTabSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SectionSkeleton heading={false}>
        <div className="flex flex-col gap-2">
          <FieldSkeleton />
          <FieldNoteSkeleton />
        </div>
      </SectionSkeleton>
      <SectionSkeleton description={false}>
        <div className="flex flex-col gap-8">
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <FieldSkeleton tall />
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <SaveRowSkeleton />
      </SectionSkeleton>
    </div>
  )
}

/** Mirrors `OutreachTab` with instructions set: the Edit action over the text. */
export function OutreachTabSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Skeleton shape="xl" className="h-8 w-16" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton shape="full" className="h-3.5 w-full" />
        <Skeleton shape="full" className="h-3.5 w-full" />
        <Skeleton shape="full" className="h-3.5 w-4/5" />
        <Skeleton shape="full" className="h-3.5 w-3/5" />
      </div>
    </div>
  )
}

/** Mirrors `BlocklistTab`: search, scope filter and Add, over the table. */
export function BlocklistTabSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <Skeleton shape="xl" className="h-8 min-w-56 flex-1" />
          <Skeleton shape="xl" className="h-8 w-60" />
        </div>
        <Skeleton shape="xl" className="h-8 w-16" />
      </div>
      <BlocklistTableSkeleton />
    </div>
  )
}

/** Mirrors `SendingTab`: the sending-window form, then the automation switch. */
export function SendingTabSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SectionSkeleton heading={false}>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <FieldSkeleton />
            <FieldNoteSkeleton />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton shape="full" className="h-3.5 w-28" />
            <div className="flex flex-wrap items-center gap-2">
              {WEEKDAY_KEYS.map((day) => (
                <Skeleton key={day} shape="xl" className="h-8 w-12" />
              ))}
            </div>
          </div>
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <div className="flex flex-col gap-2">
            <FieldSkeleton />
            <FieldNoteSkeleton />
          </div>
        </div>
        <SaveRowSkeleton note />
      </SectionSkeleton>
      <SectionSkeleton>
        <Skeleton shape="full" className="h-3.5 w-20" />
        <Skeleton shape="xl" className="h-7 w-40" />
      </SectionSkeleton>
    </div>
  )
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

/** Mirrors `AccountTab`: the identity rows, then sign-out. */
export function AccountTabSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SectionSkeleton heading={false}>
        <div className="flex justify-end">
          <Skeleton shape="xl" className="h-8 w-36" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton shape="full" className="h-3.5 w-56" />
          <Skeleton shape="full" className="h-3.5 w-40" />
        </div>
      </SectionSkeleton>
      <SectionSkeleton>
        <Skeleton shape="xl" className="h-8 w-24" />
      </SectionSkeleton>
    </div>
  )
}
