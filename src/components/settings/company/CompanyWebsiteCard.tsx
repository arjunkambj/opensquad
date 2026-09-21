import { AnalysisFailurePanel } from "@/components/kit/AnalysisFailurePanel"
import { PageSection } from "@/components/kit/PageSection"
import { WebsiteAnalyzeField } from "@/components/kit/WebsiteAnalyzeField"
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
  /** Retry has nothing it could read: no address, or one that answered nowhere. */
  retryBlocked: boolean
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
  retryBlocked,
}: CompanyWebsiteCardProps) {
  return (
    <PageSection>
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
          retryDisabled={analyzing || blockedReason !== null || retryBlocked}
        />
      )}
    </PageSection>
  )
}
