import * as React from "react"
import { cn } from "cn"

/**
 * Styled native <select>. The shadcn/Base-UI Select primitive is not installed
 * in this project; where a simple option picker is needed (timezone, member
 * role) a real <select> keeps keyboard/screen-reader behavior for free.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 appearance-none rounded-2xl bg-input/50 bg-[linear-gradient(45deg,transparent_50%,var(--muted-foreground)_50%),linear-gradient(135deg,var(--muted-foreground)_50%,transparent_50%)] bg-[position:calc(100%-19px)_50%,calc(100%-14px)_50%] bg-[size:5px_5px] bg-no-repeat px-2.5 py-1 pr-8 text-base transition-[color,box-shadow] duration-200 outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
