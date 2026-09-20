/**
 * The lead drawer behind `/contacts?lead=…` (PLAN §5).
 *
 * It owns its own reads — the lead detail and the lead's threads — so the
 * table does not carry prose it never shows, and a shared link opens the same
 * lead over the same filtered page.
 *
 * A lead id from a hand-edited or stale link resolves to NOT_FOUND on the
 * backend; the drawer says the record is gone rather than sitting on a
 * spinner, and closing it drops the param.
 */
import { useNavigate } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Chip, formatWaited } from "@/components/shared/presentation"
import { LoadingState } from "@/components/states/states"
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
} from "../contacts-model"
import { LeadActivity } from "./LeadActivity"
import { LeadDrawerActions } from "./LeadDrawerActions"
import { LeadFacts } from "./LeadFacts"
import { LeadResearchPanel } from "./LeadResearchPanel"

export function LeadDrawer({
  orgId,
  prospectId,
  busy,
  spend,
  prices,
  onClose,
  onApprove,
  onReject,
  onGetEmail,
  onResearch,
}: {
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
}) {
  const navigate = useNavigate()
  const detail = useQuery(api.leads.queries.getDetail, {
    orgId,
    prospectId,
  })
  const conversations = useQuery(api.inbox.conversations.listForProspect, {
    orgId,
    prospectId,
  })

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
        {detail === undefined ? (
          <div className="p-6">
            <LoadingState title="Opening contact" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{personName(detail.lead)}</SheetTitle>
              <SheetDescription>
                {[detail.lead.jobTitle, detail.lead.companyName]
                  .filter(
                    (part): part is string =>
                      part !== undefined && part.length > 0,
                  )
                  .join(" · ")}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip>{STAGE_LABEL[detail.lead.stage]}</Chip>
                <Chip>{APPROVAL_LABEL[detail.lead.approval]}</Chip>
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
        )}
      </SheetContent>
    </Sheet>
  )
}
