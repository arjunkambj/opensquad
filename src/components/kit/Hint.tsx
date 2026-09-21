import type { ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Explains the thing it wraps on hover. Use it wherever an action or value
 * needs a sentence of context — cost, consequence, why it is disabled —
 * instead of the native `title` attribute.
 *
 * The trigger is a wrapping span so the hint still shows on a disabled
 * button, which receives no pointer events of its own.
 */
export function Hint({
  content,
  side = "top",
  children,
}: {
  content: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  children: ReactNode
}) {
  if (content === null || content === undefined || content === "") {
    return children
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  )
}
