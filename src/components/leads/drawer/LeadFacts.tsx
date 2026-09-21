import type { LeadDetailData } from "../leads-model"
import { EMAIL_STATE_LABEL } from "../leads-model"
import { SignalCell } from "../table/SignalCell"

export function LeadFacts({ lead }: { lead: LeadDetailData["lead"] }) {
  const location = [lead.location?.city, lead.location?.state, lead.location?.country]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(", ")

  const rows: { label: string; value: string }[] = []
  if (lead.companyName !== undefined) {
    rows.push({ label: "Company", value: lead.companyName })
  }
  if (lead.company?.industry !== undefined) {
    rows.push({ label: "Industry", value: lead.company.industry })
  }
  if (lead.company?.employeeCount !== undefined) {
    rows.push({
      label: "Employees",
      value: String(lead.company.employeeCount),
    })
  }
  if (lead.canonicalDomain !== undefined) {
    rows.push({ label: "Website", value: lead.canonicalDomain })
  }
  if (location !== "") {
    rows.push({ label: "Location", value: location })
  }
  rows.push({
    label: "Email",
    value:
      lead.emailStatus === "found" && lead.email !== undefined
        ? lead.email
        : EMAIL_STATE_LABEL[lead.emailStatus],
  })

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-foreground">Details</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 truncate text-sm text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">Found by</p>
        <SignalCell signals={lead.signals} />
      </div>
    </section>
  )
}
