/**
 * Marketing — the public site: the landing page and its sections.
 *
 * Signed-out only, and data-free — nothing here reads Convex or knows about a
 * workspace.
 */
import { CTA } from "@/components/marketing/CTA"
import { FAQ } from "@/components/marketing/FAQ"
import { Features } from "@/components/marketing/Features"
import { FirstWeek } from "@/components/marketing/FirstWeek"
import { Footer } from "@/components/marketing/Footer"
import { Hero } from "@/components/marketing/Hero"
import { HowItWorks } from "@/components/marketing/HowItWorks"
import { Pricing } from "@/components/marketing/Pricing"
import { Squad } from "@/components/marketing/Squad"

/** The landing page, in the order the story is told. */
export function MarketingHome() {
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
