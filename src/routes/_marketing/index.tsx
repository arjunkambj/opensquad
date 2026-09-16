import { createFileRoute } from "@tanstack/react-router"
import { Hero } from "@/components/Marketing/Hero"

export const Route = createFileRoute("/_marketing/")({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="relative isolate flex w-full flex-col">
      <div className="flex flex-col gap-48 pb-16">
        <div className="flex flex-col gap-16 sm:gap-20">
          <Hero />
        </div>
      </div>
    </main>
  )
}
