import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { pricingBullets } from "./content"

export function PricingSection() {
  return (
    <Section id="pricing">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-[clamp(36px,5vw,64px)]">
        <div>
          <Eyebrow className="mb-4">pricing</Eyebrow>
          <h2 className="mb-5 max-w-[15ch] text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
            One <span className="text-primary">flat</span> price. However much you
            move.
          </h2>
          <p className="mb-[18px] max-w-[46ch] text-[16.5px] leading-[1.6] text-muted-foreground">
            Custodial services take{" "}
            <b className="text-foreground">0.5–3.5% of volume</b>. Move $50k a month
            and that's <b className="text-foreground">$250–$1,750</b> — every month,
            and it grows exactly as you do.
          </p>
          <p className="max-w-[46ch] text-[16.5px] leading-[1.6] text-foreground">
            <b>A flat fee wins the moment you're serious.</b> You pay the same
            whether you move $5k or $500k.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-[clamp(32px,4vw,42px)] shadow-[0_1px_2px_rgba(17,16,20,0.04),0_30px_60px_-38px_rgba(17,16,20,0.3)]">
          <span className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground">
            PurserPay · everything included
          </span>
          <div className="mt-[18px] mb-1 flex items-baseline gap-2.5">
            <span className="text-[clamp(3rem,6vw,3.9rem)] font-bold leading-[0.9] tracking-[-0.03em] text-foreground">
              €249
            </span>
            <span className="text-[15px] text-muted-foreground">/ month</span>
          </div>
          <p className="mb-6 text-[14.5px] text-muted-foreground">
            or <b className="text-primary">€2,490/year</b> — two months free. Lock it
            in.
          </p>

          <div className="flex flex-col gap-[13px] border-t border-[#EFEDE9] pt-[22px]">
            {pricingBullets.map((bullet) => (
              <span
                key={bullet}
                className="flex gap-2.5 text-[15px] text-foreground"
              >
                <span className="font-bold text-primary">✓</span>
                {bullet}
              </span>
            ))}
          </div>

          <Button
            asChild
            className="mt-6 h-auto w-full rounded-[11px] py-4 text-[15.5px] font-semibold shadow-[0_10px_26px_-14px_rgba(15,181,201,0.55)]"
          >
            <Link href="/dashboard">Get started</Link>
          </Button>
          <p className="mt-3.5 text-center text-[12.5px] text-muted-foreground">
            Cancel anytime · Your keys never leave you
          </p>
        </div>
      </div>
    </Section>
  )
}
