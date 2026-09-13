import { Link, createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_marketing/")({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-muted-foreground">
        Convex All Gas Hackathon
      </p>
      <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground">
        Build together, in real time.
      </h1>
      <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
        OpenSquad is a shared workspace for squads that need to plan, ship, and
        stay in sync.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button nativeButton={false} render={<Link to="/sign-in" />}>
          Get started
        </Button>
      </div>
    </main>
  )
}
