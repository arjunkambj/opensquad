/**
 * Onboarding dot 4, screen 2 — the words to watch for (reference 10).
 *
 * Keywords are OPTIONAL, and the screen says so with a real path rather than
 * a disabled button: "No keywords needed" clears the list and moves on, and
 * the confirm step simply builds one strategy fewer.
 *
 * "Generate more" is the one control in setup that always costs credits —
 * `generate_keywords` has no free first run — so it states its price, checks
 * the balance before it offers itself, and says so when it cannot run.
 */
import { RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { KeywordCard } from "@/components/onboarding/steps/signals/KeywordCard"
import { KEYWORDS_GENERATION_CREDITS } from "@/components/onboarding/steps/signals/signals-model"
import { SignalsStepShell } from "@/components/onboarding/steps/signals/SignalsStepShell"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/**
 * How long the screen waits for a generation before it says the request did
 * not land. The run is a scheduled action with no status of its own, so the
 * arrival of new suggestions IS the completion signal — and this is the
 * honest end of waiting for one that never arrives.
 */
const KEYWORD_GENERATION_TIMEOUT_MS = 45_000

export function KeywordsStep(props: OnboardingStepProps) {
  const { workspaceId, progress, goNext, goBack, moving, moveError } = props
  const overview = useQuery(api.agents.strategies.overview, { workspaceId })
  const balance = useQuery(api.billing.credits.balance, { workspaceId })
  const saveKeywords = useMutation(api.agents.strategies.saveKeywords)
  const generateMore = useMutation(api.agents.strategies.generateMoreKeywords)

  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [leaving, setLeaving] = useState(false)

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

  const save = (next: string[]) => {
    setError(null)
    void (async () => {
      try {
        await saveKeywords({ workspaceId, keywords: next })
      } catch {
        setError("We couldn't save that. Try it again.")
      }
    })()
  }

  const skip = () => {
    setLeaving(true)
    setError(null)
    void (async () => {
      try {
        await saveKeywords({ workspaceId, keywords: [] })
        goNext()
      } catch {
        setError("We couldn't save that. Try it again.")
      } finally {
        setLeaving(false)
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
        await generateMore({ workspaceId })
      } catch {
        requestedAt.current = null
        setGenerating(false)
        setError("We couldn't ask for more suggestions. Try again in a moment.")
      }
    })()
  }

  return (
    <SignalsStepShell
      description="We'll watch for people writing about these, and add the ones that match your ideal customer."
      error={error}
      moveError={moveError}
      nextDisabled={moving || leaving}
      nextLoading={moving || leaving}
      onNext={goNext}
      progress={progress}
      secondaryAction={
        keywords.length === 0 ? (
          <Button
            disabled={moving || leaving}
            onClick={skip}
            size="cta"
            type="button"
            variant="ghost"
          >
            No keywords needed
          </Button>
        ) : undefined
      }
      title="Now, which keywords should we track?"
      {...(goBack === undefined
        ? {}
        : { onPrevious: goBack, previousDisabled: moving || leaving })}
    >
      <KeywordCard
        action={
          <div className="flex flex-col items-end gap-1">
            <Button
              disabled={generating || blockedReason !== null}
              onClick={askForMore}
              size="sm"
              type="button"
              variant="ghost"
            >
              {generating ? (
                <Spinner className="size-3.5" />
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
            <p className="max-w-xs text-right text-xs text-muted-foreground">
              {blockedReason ??
                `Costs ${KEYWORDS_GENERATION_CREDITS} credits each time.`}
            </p>
          </div>
        }
        disabled={overview === undefined || moving || leaving}
        keywords={keywords}
        onChange={save}
        suggestions={suggestions}
      />
    </SignalsStepShell>
  )
}
