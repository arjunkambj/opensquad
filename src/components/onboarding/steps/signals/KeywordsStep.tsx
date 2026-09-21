/** Keywords are optional, but generate_keywords always costs credits, including its first run. */
import { RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import { Hint } from "@/components/kit/Hint"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { KeywordCard } from "@/components/onboarding/steps/signals/KeywordCard"
import { KEYWORDS_GENERATION_CREDITS } from "@/components/onboarding/steps/signals/signals-model"
import { SignalsStepShell } from "@/components/onboarding/steps/signals/SignalsStepShell"
import { useMountedRef } from "@/hooks/use-mounted"
import { TextLine } from "@/components/onboarding/OnboardingSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/** New suggestions are the completion signal; stop waiting if the scheduled generation never returns. */
const KEYWORD_GENERATION_TIMEOUT_MS = 45_000

export function KeywordsStep(props: OnboardingStepProps) {
  const { orgId, progress, goNext, goBack, moving, moveError } = props
  const overview = useQuery(api.agents.strategies.overview, { orgId })
  const balance = useQuery(api.billing.credits.balance, { orgId })
  const saveKeywords = useMutation(api.agents.strategies.saveKeywords)
  const generateMore = useMutation(api.agents.strategies.generateMoreKeywords)

  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const mounted = useMountedRef()

  const keywords = overview?.keywords ?? []
  const taken = new Set(keywords.map((word) => word.toLocaleLowerCase()))
  const suggestions = (overview?.suggestedKeywords ?? []).filter(
    (word) => !taken.has(word.toLocaleLowerCase()),
  )

  // The suggestion pool only ever grows, so its length is what says a paid
  // run landed. The ref holds the length the request was made at, so a pool
  // that was already the same length does not end the wait early.
  const pool = overview?.suggestedKeywords?.length ?? 0
  const requestedAt = useRef<number | null>(null)
  useEffect(() => {
    if (!generating) {
      return
    }
    if (requestedAt.current !== null && pool > requestedAt.current) {
      requestedAt.current = null
      setGenerating(false)
      return
    }
    const timer = setTimeout(() => {
      requestedAt.current = null
      setGenerating(false)
      setError(
        "That request didn't come back. Nothing was lost — try it again, or carry on with the words you have.",
      )
    }, KEYWORD_GENERATION_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [generating, pool])

  // Every keyword edit is its own write, so two of them can be in flight at
  // once — and the answer belongs to the write that asked for it. Only the
  // LAST one may speak: an older failure arriving after a newer save
  // succeeded would put an error on a list that is saved.
  const saved = useRef(0)

  const save = (next: string[]) => {
    setError(null)
    saved.current += 1
    const attempt = saved.current
    void (async () => {
      try {
        await saveKeywords({ orgId, keywords: next })
      } catch {
        if (mounted.current && saved.current === attempt) {
          setError("We couldn't save that. Try it again.")
        }
      }
    })()
  }

  const skip = () => {
    setLeaving(true)
    setError(null)
    saved.current += 1
    const attempt = saved.current
    void (async () => {
      try {
        await saveKeywords({ orgId, keywords: [] })
        if (mounted.current && saved.current === attempt) {
          goNext()
        }
      } catch {
        if (mounted.current && saved.current === attempt) {
          setError("We couldn't save that. Try it again.")
        }
      } finally {
        if (mounted.current) {
          setLeaving(false)
        }
      }
    })()
  }

  const blockedReason =
    balance === undefined
      ? null
      : balance === null
        ? "This organization has no credit allowance, so we can't suggest more."
        : balance.remaining < KEYWORDS_GENERATION_CREDITS
          ? `More suggestions cost ${KEYWORDS_GENERATION_CREDITS} credits and you have ${balance.remaining} left.`
          : null

  const askForMore = () => {
    setError(null)
    requestedAt.current = pool
    setGenerating(true)
    void (async () => {
      try {
        await generateMore({ orgId })
      } catch {
        requestedAt.current = null
        if (mounted.current) {
          setGenerating(false)
          setError(
            "We couldn't ask for more suggestions. Try again in a moment.",
          )
        }
      }
    })()
  }

  return (
    <SignalsStepShell
      description="Topics we watch for on your leads' profiles."
      error={error}
      moveError={moveError}
      nextDisabled={moving || leaving}
      nextLoading={moving || leaving}
      onNext={goNext}
      progress={progress}
      secondaryAction={
        overview !== undefined && keywords.length === 0 ? (
          <Button
            disabled={moving || leaving}
            onClick={skip}
            type="button"
            variant="ghost"
          >
            No keywords needed
          </Button>
        ) : undefined
      }
      title="Keywords to track"
      {...(goBack === undefined
        ? {}
        : { onPrevious: goBack, previousDisabled: moving || leaving })}
    >
      {overview === undefined ? (
        <KeywordsSkeleton />
      ) : (
        <KeywordCard
          action={
            <Hint
              content={
                blockedReason ??
                `Costs ${KEYWORDS_GENERATION_CREDITS} credits each time.`
              }
            >
              <Button
                disabled={generating || blockedReason !== null}
                onClick={askForMore}
                type="button"
                variant="ghost"
              >
                {generating ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <HugeiconsIcon
                    aria-hidden="true"
                    data-icon="inline-start"
                    icon={RefreshIcon}
                    strokeWidth={2}
                  />
                )}
                Generate more
              </Button>
            </Hint>
          }
          disabled={moving || leaving}
          keywords={keywords}
          onChange={save}
          suggestions={suggestions}
        />
      )}
    </SignalsStepShell>
  )
}

/** Mirrors `KeywordCard`: the chosen keywords, then the suggestion label, its action and chips. */
function KeywordsSkeleton() {
  return (
    <SkeletonRegion label="Loading your keywords" className="gap-4">
      <div className="flex flex-wrap gap-2">
        <Skeleton shape="lg" className="h-8 w-32" />
        <Skeleton shape="lg" className="h-8 w-40" />
        <Skeleton shape="lg" className="h-8 w-28" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <TextLine size="xs" className="w-40" />
          <Skeleton shape="xl" className="h-8 w-32" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton shape="lg" className="h-8 w-28" />
          <Skeleton shape="lg" className="h-8 w-36" />
          <Skeleton shape="lg" className="h-8 w-24" />
          <Skeleton shape="lg" className="h-8 w-32" />
        </div>
      </div>
    </SkeletonRegion>
  )
}
