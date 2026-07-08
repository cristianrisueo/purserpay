import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Eyebrow } from "./Eyebrow"
import { HeroPayoutCard } from "./HeroPayoutCard"

export function Hero() {
  return (
    <section
      id="top"
      className="mx-auto w-full max-w-[1160px] px-8 pt-[clamp(52px,7vw,92px)] pb-[clamp(20px,3vw,32px)]"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-center gap-[clamp(40px,5vw,72px)]">
        <div>
          <Eyebrow className="mb-[22px]">non-custodial payouts for distributed teams</Eyebrow>
          <h1 className="mb-[22px] text-[clamp(2.5rem,5.6vw,4.3rem)] font-bold leading-[1.02] tracking-[-0.03em] text-foreground">
            Pay everyone in <span className="text-primary">one transfer.</span>
          </h1>
          <p className="mb-5 max-w-[32ch] text-[clamp(17px,1.7vw,20px)] font-medium leading-[1.45] text-foreground">
            Your money never touches our hands. Your data never leaves your machine.
          </p>
          <p className="mb-[34px] max-w-[44ch] text-[16.5px] leading-[1.65] text-muted-foreground">
            Banks won't touch your business, so payroll falls to you — a
            spreadsheet, the split math, wallet addresses copied one at a time. One
            mistyped character and the money is simply gone: no reversal, no support
            line. Purser handles the arithmetic, checks every address, and hands you
            a single batch to sign from your own wallet.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Button
              asChild
              className="h-auto rounded-[11px] px-[26px] py-[15px] text-[16px] font-semibold shadow-[0_1px_2px_rgba(17,16,20,0.06),0_10px_26px_-14px_rgba(15,181,201,0.55)]"
            >
              <Link href="/dashboard">Get started</Link>
            </Button>
            <a
              href="#how"
              className="text-[16px] font-semibold text-primary transition-colors hover:text-primary/80"
            >
              See how it works →
            </a>
          </div>
        </div>

        <HeroPayoutCard />
      </div>
    </section>
  )
}
