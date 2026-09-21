/**
 * Marketing — the public site: the landing page and its sections.
 *
 * Signed-out only, and data-free — nothing here reads Convex or knows about a
 * team. The story runs problem first, then proof: the loop, the controls that
 * keep it safe, what the trial actually costs, the questions people ask, and
 * the close. Every claim on this page has to be true of the product as built:
 * the loop, the four modes, the two approvals, the sending policy and the
 * trial credit prices, and nothing else.
 */
import { CTA } from "@/components/marketing/CTA"
import { FAQ } from "@/components/marketing/FAQ"
import { Features } from "@/components/marketing/Features"
import { Footer } from "@/components/marketing/Footer"
import { Hero } from "@/components/marketing/Hero"
import { HowItWorks } from "@/components/marketing/HowItWorks"
import { Trial } from "@/components/marketing/Trial"

/** The landing page, in the order the story is told. */
export function MarketingHome() {
  return (
    <main className="relative isolate flex w-full flex-col">
      <div className="flex flex-col gap-32 sm:gap-48">
        <Hero />
        <HowItWorks />
        <Features />
        <Trial />
        <FAQ />
        <CTA />
      </div>
      <Footer />
    </main>
  )
}
