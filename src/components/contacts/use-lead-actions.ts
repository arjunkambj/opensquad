/** Reuse the request ID for the same selection and verdict so retries record one decision. */
import { useMutation } from "convex/react"
import { useCallback, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { LeadApproval } from "../../../convex/lib/validators"
import { outcomeSummary, refusalCopy } from "./contacts-model"
import { useRequestIntents } from "@/lib/use-request-intents"

export type LeadActionName = "approve" | "reject" | "email" | "research"

export type LeadActionNotice = {
  tone: "info" | "error"
  text: string
}

export function useLeadActions(orgId: Id<"orgs">) {
  const setApproval = useMutation(api.leads.mutations.setApproval)
  const requestEmails = useMutation(api.leads.emailReveal.requestEmails)
  const researchNow = useMutation(api.leads.manualResearch.researchNow)
  const intentFor = useRequestIntents()

  const [pending, setPending] = useState<LeadActionName | null>(null)
  const [notice, setNotice] = useState<LeadActionNotice | null>(null)

  const decide = useCallback(
    async (prospectIds: Id<"prospects">[], approval: LeadApproval) => {
      if (prospectIds.length === 0) {
        return
      }
      const action = approval === "approved" ? "approve" : "reject"
      setPending(action)
      setNotice(null)
      try {
        const result = await setApproval({
          orgId,
          prospectIds,
          approval,
          ...(approval === "rejected"
            ? { reason: "Rejected from Contacts" }
            : {}),
          requestId: intentFor(prospectIds.join(","), approval),
        })
        setNotice({
          tone: "info",
          text:
            result.decided === 0
              ? "Nothing changed — those leads already carried that decision."
              : `${approval === "approved" ? "Approved" : "Rejected"} ${result.decided} ${result.decided === 1 ? "lead" : "leads"}.`,
        })
      } catch (cause) {
        setNotice({
          tone: "error",
          text: refusalCopy(cause, "Could not record that decision."),
        })
      } finally {
        setPending(null)
      }
    },
    [intentFor, setApproval, orgId],
  )

  const getEmails = useCallback(
    async (prospectIds: Id<"prospects">[]) => {
      if (prospectIds.length === 0) {
        return
      }
      setPending("email")
      setNotice(null)
      try {
        const result = await requestEmails({ orgId, prospectIds })
        setNotice({
          tone: "info",
          text: outcomeSummary("Finding emails", result),
        })
      } catch (cause) {
        setNotice({
          tone: "error",
          text: refusalCopy(cause, "Could not start finding emails."),
        })
      } finally {
        setPending(null)
      }
    },
    [requestEmails, orgId],
  )

  const research = useCallback(
    async (prospectIds: Id<"prospects">[]) => {
      if (prospectIds.length === 0) {
        return
      }
      setPending("research")
      setNotice(null)
      try {
        const result = await researchNow({ orgId, prospectIds })
        setNotice({ tone: "info", text: outcomeSummary("Research", result) })
      } catch (cause) {
        setNotice({
          tone: "error",
          text: refusalCopy(cause, "Could not start research."),
        })
      } finally {
        setPending(null)
      }
    },
    [researchNow, orgId],
  )

  const dismiss = useCallback(() => setNotice(null), [])

  return { pending, notice, dismiss, decide, getEmails, research }
}
