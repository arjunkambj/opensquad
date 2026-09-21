import { createFileRoute } from "@tanstack/react-router"
import { ContactsPage } from "@/components/contacts/ContactsPage"
import {
  optionalCursor,
  optionalPageNumber,
  optionalRecordId,
  pageSize,
  type PageSize,
} from "@/lib/search-params"

export type ContactsSearch = {
  lead?: string
  cursor?: string
  page?: number
  limit?: PageSize
}

export const Route = createFileRoute("/_dashboard/_org/contacts")({
  validateSearch: (search): ContactsSearch => ({
    lead: optionalRecordId(search.lead),
    cursor: optionalCursor(search.cursor),
    page: optionalPageNumber(search.page),
    limit: pageSize(search.limit),
  }),
  component: ContactsPage,
})
