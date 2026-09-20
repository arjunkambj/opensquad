/**
 * Settings → Blocklist (reference 26, PLAN §5).
 *
 * The addresses and domains the agent may never contact. Not a preference
 * list: it is the same `suppressions` table the send boundary checks before
 * every send and before a paused conversation resumes, so anything added here
 * refuses mail immediately.
 *
 * The container owns the page query and, through `use-blocklist-writes`, both
 * mutations; the filters, the table, the pager, the empty state and the two
 * dialogs are presentational.
 */
import { Add01Icon, ShieldBanIcon } from "@hugeicons/core-free-icons"
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
import { BlocklistTable } from "@/components/settings/blocklist/BlocklistTable"
import { RemoveBlockDialog } from "@/components/settings/blocklist/RemoveBlockDialog"
import { useBlocklistWrites } from "@/components/settings/blocklist/use-blocklist-writes"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import { LoadingState, PermissionNote } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { canEdit } from "@/lib/workspace-role"
import type { WorkspaceRole } from "@/lib/workspace-role"

type Cursor = { at: number; id: Id<"suppressions"> }

export function BlocklistTab({
  workspaceId,
  role,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
}) {
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
    workspaceId,
    ...(kind === "all" ? {} : { kind }),
    ...(search.trim() === "" ? {} : { search: search.trim() }),
    ...(after === undefined ? {} : { after }),
  })

  const writes = useBlocklistWrites({
    workspaceId,
    onAdded: () => {
      setAdding(false)
      setTrail([])
    },
    onRemoved: () => {
      setPendingRemove(null)
      setTrail([])
    },
  })

  const editable = canEdit(role)
  const filtered = kind !== "all" || search.trim() !== ""

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionHeaderCard
        icon={ShieldBanIcon}
        title="Blocklist"
        description="Addresses and domains your agent may never contact. Unsubscribes and bounces land here on their own."
        action={
          editable ? (
            <Button onClick={() => setAdding(true)} type="button">
              <HugeiconsIcon
                aria-hidden="true"
                data-icon="inline-start"
                icon={Add01Icon}
                strokeWidth={2}
              />
              Add to blocklist
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
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

          {result === undefined ? (
            <LoadingState title="Loading the blocklist" />
          ) : result.entries.length === 0 ? (
            <BlocklistEmpty
              canEdit={editable}
              filtered={filtered}
              role={role}
              onAdd={() => setAdding(true)}
              onClearFilters={() => {
                setSearch("")
                setKind("all")
                setTrail([])
              }}
            />
          ) : (
            <BlocklistTable
              canEdit={editable}
              entries={result.entries}
              onRemove={setPendingRemove}
              removing={writes.busy === "remove"}
            />
          )}

          {result?.truncated === true ? (
            <InfoBanner title="Showing the most recent entries.">
              This workspace holds more blocked entries than one page request
              reads. Search for an address or a domain to find a specific one.
            </InfoBanner>
          ) : null}

          {editable ? null : (
            <PermissionNote role={role} action="add or remove entries" />
          )}
        </CardContent>

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
      </Card>

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
