import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const skeletonVariants = cva("animate-pulse bg-foreground/10", {
  variants: {
    shape: {
      default: "rounded-2xl",
      xl: "rounded-xl",
      lg: "rounded-lg",
      full: "rounded-full",
    },
  },
  defaultVariants: {
    shape: "default",
  },
})

function Skeleton({
  className,
  shape = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape}
      className={cn(skeletonVariants({ shape }), className)}
      {...props}
    />
  )
}

export { Skeleton }
