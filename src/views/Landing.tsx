import { FaqSection } from "@/components/landing/FaqSection"
import { Hero } from "@/components/landing/Hero"
import { InvitedBanner } from "@/components/landing/InvitedBanner"
import { Modules } from "@/components/landing/Modules"
import { PricingSection } from "@/components/landing/PricingSection"
import { SiteFooter } from "@/components/landing/SiteFooter"
import { SiteHeader } from "@/components/landing/SiteHeader"

// Single-page IA: Manifiesto (#why) → Modules (#how) → Pricing (#pricing) → FAQ.
export function Landing() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main>
        <InvitedBanner />
        <Hero />
        <div className="mx-auto w-full max-w-[1160px] px-8 pt-[clamp(36px,5vw,56px)]">
          <div className="h-px bg-border" />
        </div>
        <Modules />
        <PricingSection />
        <FaqSection />
      </main>
      <SiteFooter />
    </div>
  )
}

export default Landing
