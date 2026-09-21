import { CTA } from "@/components/marketing/CTA"
import { FAQ } from "@/components/marketing/FAQ"
import { Features } from "@/components/marketing/Features"
import { Footer } from "@/components/marketing/Footer"
import { Hero } from "@/components/marketing/Hero"
import { HowItWorks } from "@/components/marketing/HowItWorks"
import { Pricing } from "@/components/marketing/Pricing"

export function MarketingHome() {
  return (
    <main className="relative isolate flex w-full flex-col">
      <div className="flex flex-col gap-32 sm:gap-48">
        <Hero />
        <HowItWorks />
        <Features />
        <Pricing />
        <FAQ />
        <CTA />
      </div>
      <Footer />
    </main>
  )
}
