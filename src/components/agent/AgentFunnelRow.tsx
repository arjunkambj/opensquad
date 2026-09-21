import {
  FavouriteIcon,
  InboxIcon,
  MailSend01Icon,
} from "@hugeicons/core-free-icons"
import { StatCard } from "@/components/kit/StatCard"
import { boundedCount } from "@/lib/bounded-count"
import type { AgentFunnel } from "./agent-model"
import { ratePercent } from "./agent-model"

/** The outreach funnel as three figures, each with the rate from the step before. */
export function AgentFunnelRow({ funnel }: { funnel: AgentFunnel | undefined }) {
  const loading = funnel === undefined
  const bounded = (value: number) =>
    funnel === undefined ? "" : boundedCount(value, funnel.bounded)
  const contactedShare =
    funnel === undefined ? null : ratePercent(funnel.contacted, funnel.total)
  const replyShare =
    funnel === undefined ? null : ratePercent(funnel.replied, funnel.contacted)
  const interestShare =
    funnel === undefined ? null : ratePercent(funnel.interested, funnel.replied)

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Contacted"
        icon={MailSend01Icon}
        loading={loading}
        value={funnel === undefined ? "" : bounded(funnel.contacted)}
        sublabel={
          funnel === undefined
            ? undefined
            : contactedShare === null
              ? "No leads yet"
              : `${contactedShare}% of ${bounded(funnel.total)} leads found`
        }
      />
      <StatCard
        label="Replied"
        icon={InboxIcon}
        loading={loading}
        value={funnel === undefined ? "" : bounded(funnel.replied)}
        // A rate over nobody is unknown, not zero.
        sublabel={
          loading
            ? undefined
            : replyShare === null
              ? "No reply rate yet"
              : `${replyShare}% reply rate`
        }
      />
      <StatCard
        label="Interested"
        icon={FavouriteIcon}
        loading={loading}
        value={funnel === undefined ? "" : bounded(funnel.interested)}
        sublabel={
          loading
            ? undefined
            : interestShare === null
              ? "None yet"
              : `${interestShare}% of replies`
        }
      />
    </div>
  )
}
