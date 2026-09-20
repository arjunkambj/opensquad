import {
  ApertureIcon,
  Bread01Icon,
  DeliveryTruck01Icon,
  DentalToothIcon,
  ScaleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { cn } from "@/lib/utils"

// Fictional demo companies. Each gets a brand-colored tile and an icon that
// fits the business, so lead lists read as companies rather than people.
const marks: Record<string, { icon: IconSvgElement; className: string }> = {
  "Northwind Studio": { icon: ApertureIcon, className: "bg-[#1f3a5f] text-white" },
  "Harbor Dental": { icon: DentalToothIcon, className: "bg-[#2a9d8f] text-white" },
  "Fieldstone Law": { icon: ScaleIcon, className: "bg-[#4a3f35] text-white" },
  "Juniper Bakery": { icon: Bread01Icon, className: "bg-[#c97b3a] text-white" },
  "Acme Logistics": { icon: DeliveryTruck01Icon, className: "bg-[#b5341f] text-white" },
}

export function CompanyMark({
  company,
  className,
}: {
  company: string
  className?: string
}) {
  const mark = marks[company]
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        mark?.className ?? "bg-muted text-foreground",
        className,
      )}
    >
      {mark ? (
        <HugeiconsIcon className="size-5" icon={mark.icon} strokeWidth={2} />
      ) : (
        <span className="text-sm font-medium">{company.charAt(0)}</span>
      )}
    </span>
  )
}
