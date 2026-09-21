import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { AddBlockDialog } from "@/components/settings/blocklist/AddBlockDialog"
import { BlocklistEmpty } from "@/components/settings/blocklist/BlocklistEmpty"
import { BlocklistFilters } from "@/components/settings/blocklist/BlocklistFilters"
import type { BlocklistKindFilter } from "@/components/settings/blocklist/BlocklistFilters"
import { BlocklistPager } from "@/components/settings/blocklist/BlocklistPager"
import {
  BlocklistTable,
  BlocklistTableSkeleton,
} from "@/components/settings/blocklist/BlocklistTable"
import { RemoveBlockDialog } from "@/components/settings/blocklist/RemoveBlockDialog"
import { useBlocklistWrites } from "@/components/settings/blocklist/use-blocklist-writes"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Button } from "@/components/ui/button"

type Cursor = { at: number; id: Id<"suppressions"> }

export function BlocklistTab({ orgId }: { orgId: Id<"orgs"> }) {
  const [kind, setKind] = useState<BlocklistKindFilter>("all")
  const [search, setSearch] = useState("")
  // The cursors of every page BEFORE the current one, so Back is a pop rather
  // than a second query guessing where it came from.
  const [trail, setTrail] = useState<Cursor[]>([])
  const [adding, setAdding] = useState(false)
  const [pendingRemove, setPendingRemove] =
    useState<Doc<"suppressions"> | null>(null)

  const after = trail.at(-1)
  const result = useQuery(api.outreach.suppressions.page, {
    orgId,
    ...(kind === "all" ? {} : { kind }),
    ...(search.trim() === "" ? {} : { search: search.trim() }),
    ...(after === undefined ? {} : { after }),
  })

  const writes = useBlocklistWrites({
    orgId,
    onAdded: () => {
      setAdding(false)
      setTrail([])
    },
    onRemoved: () => {
      setPendingRemove(null)
      setTrail([])
    },
  })

  const filtered = kind !== "all" || search.trim() !== ""

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <BlocklistFilters
            kind={kind}
            search={search}
            onKindChange={(next) => {
              setKind(next)
              setTrail([])
            }}
            onSearchChange={(next) => {
              setSearch(next)
              // Page 3 of one filter is not page 3 of another.
              setTrail([])
            }}
          />
        </div>
        <Button onClick={() => setAdding(true)} type="button">
          <HugeiconsIcon
            aria-hidden="true"
            data-icon="inline-start"
            icon={Add01Icon}
            strokeWidth={2}
          />
          Add
        </Button>
      </div>

      {result === undefined ? (
        <SkeletonRegion label="Loading the blocklist">
          <BlocklistTableSkeleton />
        </SkeletonRegion>
      ) : result.entries.length === 0 ? (
        <BlocklistEmpty
          filtered={filtered}
          onAdd={() => setAdding(true)}
          onClearFilters={() => {
            setSearch("")
            setKind("all")
            setTrail([])
          }}
        />
      ) : (
        <BlocklistTable
          entries={result.entries}
          onRemove={setPendingRemove}
          removing={writes.busy === "remove"}
        />
      )}

      {result?.truncated === true ? (
        <InfoBanner title="Showing the most recent entries.">
          Search for an address or a domain to find a specific one.
        </InfoBanner>
      ) : null}

      {result === undefined || result.matched === 0 ? null : (
        <BlocklistPager
          canGoBack={trail.length > 0}
          canGoNext={result.nextCursor !== null}
          filtered={filtered}
          matched={result.matched}
          onBack={() => setTrail(trail.slice(0, -1))}
          onNext={() => {
            if (result.nextCursor !== null) {
              setTrail([...trail, result.nextCursor])
            }
          }}
        />
      )}

      <AddBlockDialog
        busy={writes.busy === "add"}
        error={writes.addError}
        open={adding}
        onOpenChange={(next) => {
          setAdding(next)
          if (!next) {
            writes.clearAddError()
          }
        }}
        onSubmit={writes.add}
      />
      <RemoveBlockDialog
        busy={writes.busy === "remove"}
        entry={pendingRemove}
        error={writes.removeError}
        onCancel={() => {
          setPendingRemove(null)
          writes.clearRemoveError()
        }}
        onConfirm={() => {
          if (pendingRemove !== null) {
            writes.remove(pendingRemove)
          }
        }}
      />
    </div>
  )
}
