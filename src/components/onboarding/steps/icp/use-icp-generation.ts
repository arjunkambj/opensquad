/**
 * Asking for the ICP to be written, and knowing where that stands.
 *
 * It owns the automatic first run: entering dot 2 asks for one, and the
 * mutation is a no-op unless the agent has never had a generation — so the
 * request is safe on every mount, on every device, forever, and the run it
 * starts is the free one (PLAN §6).
 *
 * It also owns the only question the screen cannot answer on its own: whether
 * another run can be afforded. The price comes from what has already been
 * generated and the balance from the real ledger, so a button that cannot buy
 * anything is disabled with a reason rather than failing when pressed.
 */
import { useMutation, useQuery } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../../convex/_generated/dataModel"
import { startGenerationCopy } from "@/components/onboarding/steps/icp/icp-copy"
import type { IcpMessage } from "@/components/onboarding/steps/icp/icp-copy"
import {
  icpGenerationPrice,
  icpGenerationView,
} from "@/components/onboarding/steps/icp/icp-model"
import type { IcpGenerationView } from "@/components/onboarding/steps/icp/icp-model"

/** Why a run is being asked for. `initial` is the automatic free one. */
export type IcpRunReason = "initial" | "retry" | "regenerate"

/** A refused request, with the run it was refusing — so Try again asks for
 *  the same thing and a refused FREE run is never retried as a paid one. */
export type IcpStartRefusal = { message: IcpMessage; reason: IcpRunReason }

export type IcpGenerationHandle = {
  view: IcpGenerationView
  /** Credits the next run costs; `0` while the free first run is there. */
  price: number
  /** Why another run cannot happen, or `null`. */
  blockedReason: string | null
  /** A request is in flight. */
  starting: boolean
  refusal: IcpStartRefusal | null
  clearRefusal: () => void
  run: (reason: IcpRunReason) => void
}

export function useIcpGeneration(
  workspaceId: Id<"workspaces">,
  agent: Doc<"agents">,
): IcpGenerationHandle {
  const startGeneration = useMutation(api.agents.icp.startGeneration)
  const balance = useQuery(api.billing.credits.balance, { workspaceId })

  const [refusal, setRefusal] = useState<IcpStartRefusal | null>(null)
  const [starting, setStarting] = useState(false)

  const view = icpGenerationView(agent)
  const price = icpGenerationPrice(view)

  const start = useCallback(
    async (reason: IcpRunReason) => {
      setStarting(true)
      setRefusal(null)
      try {
        await startGeneration({ workspaceId, reason })
      } catch (cause) {
        setRefusal({ message: startGenerationCopy(cause), reason })
      } finally {
        setStarting(false)
      }
    },
    [startGeneration, workspaceId],
  )

  // One automatic request per mount. The server decides whether it runs.
  const requested = useRef(false)
  useEffect(() => {
    if (view.state !== "never" || requested.current) {
      return
    }
    requested.current = true
    void start("initial")
  }, [start, view.state])

  const blockedReason =
    balance === undefined || price === 0
      ? null
      : balance === null
        ? "This workspace has no credit allowance, so another run can't happen. You can still edit everything here yourself."
        : balance.remaining < price
          ? `Another run costs ${price} credits and you have ${balance.remaining} left. Edit the chips yourself to carry on.`
          : null

  return {
    view,
    price,
    blockedReason,
    starting,
    refusal,
    clearRefusal: useCallback(() => {
      setRefusal(null)
    }, []),
    run: useCallback(
      (reason: IcpRunReason) => {
        void start(reason)
      },
      [start],
    ),
  }
}
