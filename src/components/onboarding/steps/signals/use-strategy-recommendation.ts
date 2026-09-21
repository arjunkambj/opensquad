/** The automatic request is idempotent: the server starts it only if no recommendation exists. */
import { useMutation, useQuery } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import type { GenerationStatus } from "../../../../../convex/lib/validators"
import { startRecommendationCopy } from "@/components/onboarding/steps/signals/signals-copy"
import type { SignalsMessage } from "@/components/onboarding/steps/signals/signals-copy"
import {
  signalsGenerationPrice,
  signalsGenerationView,
} from "@/components/onboarding/steps/signals/signals-model"
import type { SignalsGenerationView } from "@/components/onboarding/steps/signals/signals-model"
import { useMountedRef } from "@/hooks/use-mounted"

export type SignalsRunReason = "initial" | "retry" | "regenerate"

/** A refused request, with the run it was refusing — so Try again asks for
 *  the same thing and a refused FREE run is never retried as a paid one. */
type SignalsStartRefusal = {
  message: SignalsMessage
  reason: SignalsRunReason
}

export type SignalsGenerationHandle = {
  view: SignalsGenerationView
  /** Credits the next run costs; `0` while the free first run is there. */
  price: number
  blockedReason: string | null
  starting: boolean
  refusal: SignalsStartRefusal | null
  clearRefusal: () => void
  run: (reason: SignalsRunReason) => void
}

export function useStrategyRecommendation(
  orgId: Id<"orgs">,
  status: GenerationStatus | null | undefined,
): SignalsGenerationHandle {
  const startRecommendation = useMutation(
    api.agents.strategies.startRecommendation,
  )
  const balance = useQuery(api.billing.credits.balance, { orgId })

  const [refusal, setRefusal] = useState<SignalsStartRefusal | null>(null)
  const [starting, setStarting] = useState(false)
  const mounted = useMountedRef()

  const view = signalsGenerationView(status ?? null)
  const price = signalsGenerationPrice(view)

  // Only the latest attempt may update state, and only while the screen is mounted.
  const attempts = useRef(0)

  const start = useCallback(
    async (reason: SignalsRunReason) => {
      attempts.current += 1
      const attempt = attempts.current
      setStarting(true)
      setRefusal(null)
      try {
        await startRecommendation({ orgId, reason })
      } catch (cause) {
        if (mounted.current && attempts.current === attempt) {
          setRefusal({ message: startRecommendationCopy(cause), reason })
        }
      } finally {
        if (mounted.current && attempts.current === attempt) {
          setStarting(false)
        }
      }
    },
    [mounted, startRecommendation, orgId],
  )

  // One automatic request per mount, and only once the status has actually
  // loaded — asking while the query is still `undefined` would fire a second
  // run on every entry.
  const requested = useRef(false)
  useEffect(() => {
    if (status === undefined || view.state !== "never" || requested.current) {
      return
    }
    requested.current = true
    void start("initial")
  }, [start, status, view.state])

  const blockedReason =
    balance === undefined || price === 0
      ? null
      : balance === null
        ? "This organization has no credit allowance, so another run can't happen. Pick from the signals already here and carry on."
        : balance.remaining < price
          ? `Another run costs ${price} credits and you have ${balance.remaining} left.`
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
      (reason: SignalsRunReason) => {
        void start(reason)
      },
      [start],
    ),
  }
}
