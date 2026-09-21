import { CatchBoundary, useNavigate } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { stageChipVariant } from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
import { ErrorState } from "@/components/states/states"
import { formatWaited } from "@/lib/presentation"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  APPROVAL_LABEL,
  personName,
  STAGE_LABEL,
  type SpendContext,
} from "../leads-model"
import { LeadActivity } from "./LeadActivity"
import { LeadDrawerActions } from "./LeadDrawerActions"
import { LeadDrawerSkeleton } from "./LeadDrawerSkeleton"
import { LeadFacts } from "./LeadFacts"
import { LeadResearchPanel } from "./LeadResearchPanel"

type LeadDrawerProps = {
  orgId: Id<"orgs">
  prospectId: Id<"prospects">
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  onClose: () => void
  onApprove: (prospectId: Id<"prospects">) => void
  onReject: (prospectId: Id<"prospects">) => void
  onGetEmail: (prospectId: Id<"prospects">) => void
  onResearch: (prospectId: Id<"prospects">) => void
}

export function LeadDrawer(props: LeadDrawerProps) {
  const { prospectId, onClose } = props
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {/* A `?lead=` pointing at a removed lead, or one in another
            organization, refuses the read. It closes the drawer rather than
            taking the page down with it. */}
        <CatchBoundary
          getResetKey={() => prospectId}
          errorComponent={() => (
            <>
              <SheetHeader>
                <SheetTitle className="sr-only">Lead unavailable</SheetTitle>
              </SheetHeader>
              <div className="px-6 pb-6">
                <ErrorState
                  title="This lead could not be opened"
                  description="It is no longer here, or it belongs to another organization."
                  onRetry={onClose}
                  retryLabel="Close"
                />
              </div>
            </>
          )}
        >
          <LeadDrawerBody {...props} />
        </CatchBoundary>
      </SheetContent>
    </Sheet>
  )
}

function LeadDrawerBody({
  orgId,
  prospectId,
  busy,
  spend,
  prices,
  onApprove,
  onReject,
  onGetEmail,
  onResearch,
}: LeadDrawerProps) {
  const navigate = useNavigate()
  const detail = useQuery(api.leads.queries.getDetail, {
    orgId,
    prospectId,
  })
  const conversations = useQuery(api.inbox.conversations.listForProspect, {
    orgId,
    prospectId,
  })

  if (detail === undefined) {
    return <LeadDrawerSkeleton />
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{personName(detail.lead)}</SheetTitle>
        <SheetDescription>
          {[detail.lead.jobTitle, detail.lead.companyName]
            .filter(
              (part): part is string => part !== undefined && part.length > 0,
            )
            .join(" · ")}
        </SheetDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip variant={stageChipVariant(detail.lead.stage)}>
            {STAGE_LABEL[detail.lead.stage]}
          </Chip>
          <Chip
            variant={detail.lead.approval === "approved" ? "success" : "muted"}
          >
            {APPROVAL_LABEL[detail.lead.approval]}
          </Chip>
          <span className="text-xs text-muted-foreground">
            Imported {formatWaited(detail.lead.createdAt)}
          </span>
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-6 pb-6">
        <LeadDrawerActions
          lead={detail.lead}
          busy={busy}
          spend={spend}
          prices={prices}
          onApprove={() => onApprove(detail.lead._id)}
          onReject={() => onReject(detail.lead._id)}
          onGetEmail={() => onGetEmail(detail.lead._id)}
          onResearch={() => onResearch(detail.lead._id)}
        />
        <LeadResearchPanel
          research={detail.lead.research}
          evidence={detail.evidence}
        />
        <LeadFacts lead={detail.lead} />
        <LeadActivity
          conversations={conversations}
          events={detail.events}
          onOpenConversation={(conversationId) =>
            void navigate({
              to: "/inbox/$conversationId",
              params: { conversationId },
            })
          }
        />
      </div>
    </>
  )
}
