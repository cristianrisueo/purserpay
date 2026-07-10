import { Eyebrow } from "./Eyebrow"
import { HeroPayoutCard } from "./HeroPayoutCard"

// Bloque 0 — the operating manifesto (#why). Side A states the product plainly:
// non-custodial money, device-local roster, the software does the arithmetic and
// CSV parsing, and you keep control of a single batch signature. Side B is the
// static telemetry preview (HeroPayoutCard). The primary action lives once, in the
// nav CTA — the hero keeps only a quiet "See how it works" anchor to avoid a second
// competing button.
export function Hero() {
  return (
    <section
      id="why"
      className="mx-auto w-full max-w-[1160px] px-8 pt-[clamp(52px,7vw,92px)] pb-[clamp(20px,3vw,32px)]"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-center gap-[clamp(40px,5vw,72px)]">
        <div>
          <Eyebrow className="mb-[22px]">non-custodial payouts for distributed teams</Eyebrow>
          <h1 className="mb-[22px] text-[clamp(2.5rem,5.6vw,4.3rem)] font-bold leading-[1.02] tracking-[-0.03em] text-foreground">
            Pay everyone in <span className="text-primary">one transfer.</span>
          </h1>
          <p className="mb-5 max-w-[34ch] text-[clamp(17px,1.7vw,20px)] font-medium leading-[1.45] text-foreground">
            Your money never leaves your wallet. Your roster never leaves your
            device.
          </p>
          <p className="mb-[34px] max-w-[46ch] text-[16.5px] leading-[1.65] text-muted-foreground">
            Banks won't touch your business, so treasury falls to you — a
            spreadsheet, the split math, wallet addresses copied one at a time,
            and the fear that one mistyped character sends the money nowhere.
            Purser does the arithmetic, parses your file, and checks every address
            — then hands you a single batch to sign from your own wallet. The
            capital stays yours from first click to last.
          </p>
          <a
            href="#how"
            className="text-[16px] font-semibold text-primary transition-colors hover:text-primary/80"
          >
            See how it works
          </a>
        </div>

        <HeroPayoutCard />
      </div>
    </section>
  )
}
