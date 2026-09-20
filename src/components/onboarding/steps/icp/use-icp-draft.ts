/**
 * The ICP as the user is editing it, and the promise that it is saved.
 *
 * Dot 2 has three screens over one record, so "every edit persists" has to
 * survive three things: a chip clicked and then a refresh, a chip clicked and
 * then Next, and the generation landing underneath an open screen.
 *
 *   - every change is written after a short pause, so a run of clicks is one
 *     round trip rather than five;
 *   - `flush` makes the pending write happen NOW and says whether it landed,
 *     which is what Previous and Next wait on;
 *   - the authoritative agent row is adopted whenever it changes and the user
 *     has nothing unsaved, which is how the generated chips appear without
 *     this hook polling anything.
 */
import { useMutation } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../../convex/_generated/dataModel"
import type { IcpDraft } from "@/components/onboarding/steps/icp/icp-model"
import { sameIcpDraft } from "@/components/onboarding/steps/icp/icp-model"
import { errorMessage } from "@/lib/convex-error"

/** Long enough to collapse a run of chip clicks, short enough that a refresh
 *  a moment later still finds the edit on the server. */
const ICP_SAVE_DEBOUNCE_MS = 600

export type IcpSaveState = "idle" | "saving" | "saved" | "error"

export type IcpDraftHandle = {
  draft: IcpDraft
  /** Replace one or more groups. Saves itself shortly afterwards. */
  change: (patch: Partial<IcpDraft>) => void
  /** Write anything pending right now; `true` when the record is up to date. */
  flush: () => Promise<boolean>
  saveState: IcpSaveState
  saveError: string | null
}

export function useIcpDraft(
  orgId: Id<"orgs">,
  agent: Doc<"agents">,
): IcpDraftHandle {
  const updateIcp = useMutation(api.agents.icp.updateIcp)

  const [draft, setDraft] = useState<IcpDraft>(agent.icp)
  const [unsaved, setUnsaved] = useState(false)
  const [saveState, setSaveState] = useState<IcpSaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState(agent.updatedAt)

  // Adopt the authoritative record whenever it changes underneath us — which
  // is how a generation lands on an open screen — without overwriting an edit
  // the user has not saved yet.
  if (agent.updatedAt !== syncedAt) {
    setSyncedAt(agent.updatedAt)
    if (!unsaved) {
      setDraft(agent.icp)
    }
  }

  // The debounce timer and `flush` fire long after the render that set them
  // up, so they read the draft from here rather than from a stale closure.
  // Written in an effect, so nothing reads a ref while rendering.
  const latest = useRef<IcpDraft>(draft)
  useEffect(() => {
    latest.current = draft
  }, [draft])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    },
    [],
  )

  const persist = useCallback(
    async (value: IcpDraft): Promise<boolean> => {
      setSaveState("saving")
      setSaveError(null)
      try {
        await updateIcp({ orgId, icp: value })
        // Only call it saved if nothing was clicked while the write was in
        // flight; otherwise the newer edit would look like it had landed.
        if (sameIcpDraft(latest.current, value)) {
          setUnsaved(false)
          setSaveState("saved")
        }
        return true
      } catch (cause) {
        setSaveState("error")
        setSaveError(
          errorMessage(cause, "We couldn't save that change. Try it again."),
        )
        return false
      }
    },
    [updateIcp, orgId],
  )

  const change = useCallback(
    (patch: Partial<IcpDraft>) => {
      const next = { ...latest.current, ...patch }
      latest.current = next
      setUnsaved(true)
      setDraft(next)
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
      timer.current = setTimeout(() => {
        timer.current = null
        void persist(next)
      }, ICP_SAVE_DEBOUNCE_MS)
    },
    [persist],
  )

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!unsaved) {
      return true
    }
    return await persist(latest.current)
  }, [persist, unsaved])

  return { draft, change, flush, saveState, saveError }
}
