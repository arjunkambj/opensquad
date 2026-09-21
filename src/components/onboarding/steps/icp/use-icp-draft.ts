/** Debounce edits, flush before navigation, and adopt server updates only when the draft is clean. */
import { useMutation } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../../convex/_generated/dataModel"
import type { IcpDraft } from "@/components/onboarding/steps/icp/icp-model"
import { sameIcpDraft } from "@/components/onboarding/steps/icp/icp-model"
import { errorMessage } from "@/lib/convex-error"

const ICP_SAVE_DEBOUNCE_MS = 600

export type IcpSaveState = "idle" | "saving" | "saved" | "error"

export type IcpDraftHandle = {
  draft: IcpDraft
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

  // Serialize debounce and navigation flushes so overlapping writes cannot land out of order.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  /** The draft the last write put on the record, so a queued ask that is
   *  already satisfied does not write it a second time. */
  const written = useRef<IcpDraft | null>(null)

  const persist = useCallback((): Promise<boolean> => {
    const run = chain.current.then(async (): Promise<boolean> => {
      // Save what the draft holds NOW: anything clicked while the previous
      // write was in flight is newer than whatever this ask was queued with.
      const value = latest.current
      if (written.current !== null && sameIcpDraft(written.current, value)) {
        setUnsaved(false)
        setSaveState("saved")
        return true
      }
      setSaveState("saving")
      setSaveError(null)
      try {
        await updateIcp({ orgId, icp: value })
        written.current = value
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
    })
    // The chain carries order, never a result and never a rejection: one
    // failed save must not stop the next one from being attempted.
    chain.current = run.catch(() => undefined)
    return run
  }, [updateIcp, orgId])

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
        void persist()
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
    return await persist()
  }, [persist, unsaved])

  return { draft, change, flush, saveState, saveError }
}
