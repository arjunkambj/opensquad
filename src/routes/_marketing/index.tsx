import { createFileRoute } from "@tanstack/react-router"
import { FAQ } from "@/components/Marketing/FAQ"
import { Features } from "@/components/Marketing/Features"
import { Hero } from "@/components/Marketing/Hero"
import { HowItWorks } from "@/components/Marketing/HowItWorks"
import { Pricing } from "@/components/Marketing/Pricing"
import { WorksWith } from "@/components/Marketing/WorksWith"

export const Route = createFileRoute("/_marketing/")({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="relative isolate flex w-full flex-col">
      <div className="flex flex-col gap-48 pb-16">
        <div className="flex flex-col gap-16 sm:gap-20">
          <Hero />
          <WorksWith />
        </div>
        <HowItWorks />
        <Features />
        <Pricing />
      </div>
    </main>
  )
}
