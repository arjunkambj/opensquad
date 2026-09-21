import { GlobeIcon } from "@hugeicons/core-free-icons"
import { AnalysisFailurePanel } from "@/components/kit/AnalysisFailurePanel"
import { WebsiteAnalyzeField } from "@/components/kit/WebsiteAnalyzeField"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import { Card, CardContent } from "@/components/ui/card"
import type { AnalysisMessage } from "@/lib/company-analysis-copy"

export type CompanyWebsiteCardProps = {
  website: string
  onWebsiteChange: (next: string) => void
  onAnalyze: () => void
  intent: "analyze" | "regenerate"
  analyzing: boolean
  /** Credits the run costs; `0` while the free first run is unused. */
  price: number
  blockedReason: string | null
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
