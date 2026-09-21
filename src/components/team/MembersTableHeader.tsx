import { TableHead, TableHeader } from "@/components/ui/table"

export function MembersTableHeader() {
  return (
    <TableHeader>
      <tr className="border-b">
        <TableHead>Name</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">
          <span className="sr-only">Actions</span>
        </TableHead>
      </tr>
    </TableHeader>
  )
}
