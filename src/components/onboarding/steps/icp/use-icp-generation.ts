/** The automatic request is idempotent: the server starts it only if no generation exists. */
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
import { useMountedRef } from "@/hooks/use-mounted"

export type IcpRunReason = "initial" | "retry" | "regenerate"

/** A refused request, with the run it was refusing — so Try again asks for
 *  the same thing and a refused FREE run is never retried as a paid one. */
type IcpStartRefusal = { message: IcpMessage; reason: IcpRunReason }

export type IcpGenerationHandle = {
  view: IcpGenerationView
  /** Credits the next run costs; `0` while the free first run is there. */
  price: number
  blockedReason: string | null
  starting: boolean
  refusal: IcpStartRefusal | null
  clearRefusal: () => void
  run: (reason: IcpRunReason) => void
}

export function useIcpGeneration(
  orgId: Id<"orgs">,
  agent: Doc<"agents">,
): IcpGenerationHandle {
  const startGeneration = useMutation(api.agents.icp.startGeneration)
  const balance = useQuery(api.billing.credits.balance, { orgId })

  const [refusal, setRefusal] = useState<IcpStartRefusal | null>(null)
  const [starting, setStarting] = useState(false)
  const mounted = useMountedRef()

  const view = icpGenerationView(agent)
  const price = icpGenerationPrice(view)

  // Only the latest attempt may update state, and only while the screen is mounted.
  const attempts = useRef(0)

  const start = useCallback(
    async (reason: IcpRunReason) => {
      attempts.current += 1
      const attempt = attempts.current
      setStarting(true)
      setRefusal(null)
      try {
        await startGeneration({ orgId, reason })
      } catch (cause) {
        if (mounted.current && attempts.current === attempt) {
          setRefusal({ message: startGenerationCopy(cause), reason })
        }
      } finally {
        if (mounted.current && attempts.current === attempt) {
          setStarting(false)
        }
      }
    },
    [mounted, startGeneration, orgId],
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
        ? "This organization has no credit allowance, so another run can't happen. You can still edit everything here yourself."
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
