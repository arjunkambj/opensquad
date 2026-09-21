import { Badge } from "@/components/ui/badge"

const groups = [
  {
    name: "All it needs to start",
    items: ["Your website", "300 free credits", "Your own inbox"],
  },
  {
    name: "What it does",
    items: ["Finds leads", "Writes the emails", "Works the replies"],
  },
] as const

export function WorksWith() {
  return (
    <div
      className="grid gap-8 md:grid-cols-[1.6fr_1fr] md:gap-0"
      id="works-with"
    >
      {groups.map((group) => (
        <div
          className="flex min-w-0 flex-col gap-4 border-border border-b pb-8 last:border-0 last:pb-0 md:border-r md:border-b-0 md:px-6 md:pb-0 md:first:pl-0 md:last:pr-0 lg:px-8"
          key={group.name}
        >
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-eyebrow">
            {group.name}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {group.items.map((item) => (
              <li key={item}>
                <Badge size="lg" variant="secondary">
                  {item}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
