import { FaqSection } from "@/components/landing/FaqSection"
import { FeaturesSection } from "@/components/landing/FeaturesSection"
import { FinalCta } from "@/components/landing/FinalCta"
import { Hero } from "@/components/landing/Hero"
import { HowItWorks } from "@/components/landing/HowItWorks"
import { MoatSection } from "@/components/landing/MoatSection"
import { PricingSection } from "@/components/landing/PricingSection"
import { ProblemSection } from "@/components/landing/ProblemSection"
import { SiteFooter } from "@/components/landing/SiteFooter"
import { SiteHeader } from "@/components/landing/SiteHeader"

export function Landing() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main>
        <Hero />
        <div className="mx-auto w-full max-w-[1160px] px-8 pt-[clamp(36px,5vw,56px)]">
          <div className="h-px bg-border" />
        </div>
        <ProblemSection />
        <HowItWorks />
        <MoatSection />
        <FeaturesSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}

export default Landing
