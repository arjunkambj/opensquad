import { createFileRoute } from "@tanstack/react-router"
import { CTA } from "@/components/marketing/CTA"
import { FAQ } from "@/components/marketing/FAQ"
import { Features } from "@/components/marketing/Features"
import { FirstWeek } from "@/components/marketing/FirstWeek"
import { Footer } from "@/components/marketing/Footer"
import { Hero } from "@/components/marketing/Hero"
import { HowItWorks } from "@/components/marketing/HowItWorks"
import { Pricing } from "@/components/marketing/Pricing"
import { Squad } from "@/components/marketing/Squad"

export const Route = createFileRoute("/_marketing/")({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="relative isolate flex w-full flex-col">
      <div className="flex flex-col gap-32 sm:gap-48">
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
