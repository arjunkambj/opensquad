import { createFileRoute } from "@tanstack/react-router"
import { CTA } from "@/components/Marketing/CTA"
import { FAQ } from "@/components/Marketing/FAQ"
import { Features } from "@/components/Marketing/Features"
import { FirstWeek } from "@/components/Marketing/FirstWeek"
import { Footer } from "@/components/Marketing/Footer"
import { Hero } from "@/components/Marketing/Hero"
import { HowItWorks } from "@/components/Marketing/HowItWorks"
import { Pricing } from "@/components/Marketing/Pricing"
import { Squad } from "@/components/Marketing/Squad"

export const Route = createFileRoute("/_marketing/")({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="relative isolate flex w-full flex-col">
      <div className="flex flex-col gap-48">
        <Hero />
        <Squad />
        <HowItWorks />
        <Features />
        <FirstWeek />
        <Pricing />
        <FAQ />
        <CTA />
      </div>
      <Footer />
    </main>
  )
}
