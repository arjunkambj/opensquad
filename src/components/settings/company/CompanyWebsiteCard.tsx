/**
 * Settings → Company, the website card: the address the profile was written
 * from, and the button that reads it again.
 *
 * Presentational. It reuses onboarding dot 1's own field and failure panel so
 * the two screens cannot drift: the same button wording, the same price
 * sentence, the same words for a blocked site. The container decides the
 * price, the reason and what a retry does.
 */
import { GlobeIcon } from "@hugeicons/core-free-icons"
import type { AnalysisMessage } from "@/components/onboarding/steps/company/analysis-copy"
import { AnalysisFailurePanel } from "@/components/onboarding/steps/company/AnalysisFailurePanel"
import { WebsiteAnalyzeField } from "@/components/onboarding/steps/company/WebsiteAnalyzeField"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import { Card, CardContent } from "@/components/ui/card"

export type CompanyWebsiteCardProps = {
  website: string
  onWebsiteChange: (next: string) => void
  onAnalyze: () => void
  /** A first read, or another one at full price. */
  intent: "analyze" | "regenerate"
  analyzing: boolean
  /** Credits the run costs; `0` while the free first run is unused. */
  price: number
  /** Our own sentence for why the button is off, or `null` when it is on. */
  blockedReason: string | null
  /** A refusal or a failed run, already turned into words. */
  failure: AnalysisMessage | null
}

export function CompanyWebsiteCard({
  website,
  onWebsiteChange,
  onAnalyze,
  intent,
  analyzing,
  price,
  blockedReason,
  failure,
}: CompanyWebsiteCardProps) {
  return (
    <>
      <SectionHeaderCard
        icon={GlobeIcon}
        title="Website"
        description="Reading your site again rewrites the profile below. Everything it writes stays yours to edit."
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <WebsiteAnalyzeField
            analyzing={analyzing}
            blockedReason={blockedReason}
            intent={intent}
            onAnalyze={onAnalyze}
            onChange={onWebsiteChange}
            price={price}
            value={website}
          />
          {failure === null ? null : (
            <AnalysisFailurePanel
              message={failure}
              onRetry={onAnalyze}
              retryDisabled={analyzing || blockedReason !== null}
            />
          )}
        </CardContent>
      </Card>
    </>
  )
}
