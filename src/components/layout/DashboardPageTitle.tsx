import type { ReactNode } from "react"

type Props = {
  title: string
  description?: ReactNode
  actions?: ReactNode
}

export function DashboardPageTitle({ title, description, actions }: Props) {
  return (
    <header className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
