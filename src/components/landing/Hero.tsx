import { Eyebrow } from "./Eyebrow"
import { HeroPayoutCard } from "./HeroPayoutCard"
import { heroBenefits } from "./content"

// Bloque 0 — the operating manifesto (#why). Side A restores the original headline
// ("Pay everyone in one transfer.") and, in place of a subhead paragraph, runs a six-item
// benefits checklist led by the brand's aqua ✓✓ double-check — the same mark the dashboard uses
// for "verified". The checklist is the taller left block, and the right card is centred against it
// on desktop (items-center); every claim is fidelity-bound to a shipped feature (see heroBenefits
// in content.tsx). Side B is
// the static dashboard replica (HeroPayoutCard), a faithful snapshot of the real pre-flight. The
// primary action lives once, in the nav CTA — the hero keeps only a quiet "See how it works" anchor.
export function Hero() {
  return (
    <section
      id="why"
      className="mx-auto w-full max-w-[1160px] px-8 pt-[clamp(52px,7vw,92px)] pb-[clamp(20px,3vw,32px)]"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-center gap-[clamp(40px,5vw,72px)]">
        <div className="flex flex-col">
          <Eyebrow className="mb-[22px]">non-custodial payouts for distributed teams</Eyebrow>
          <h1 className="mb-[30px] text-[clamp(2.1rem,4.6vw,3.4rem)] font-bold leading-[1.05] tracking-[-0.03em] text-foreground">
            Pay everyone in <span className="text-primary">one transfer.</span>
          </h1>

          {/* Benefits checklist — each item led by the aqua ✓✓ double-check, bold lead line over a
              muted supporting sentence. Natural gap between items; this column is the taller block and
              the payout card is centred against it on desktop (items-center on the grid). */}
          <ul className="flex flex-col gap-[clamp(16px,1.8vw,22px)]">
            {heroBenefits.map((b) => (
              <li key={b.title} className="grid grid-cols-[auto_1fr] items-start gap-x-3">
                <span
                  className="text-[15px] font-bold leading-[1.45] text-primary"
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold leading-[1.45] text-foreground">
                    {b.title}
                  </span>
                  <span className="mt-1 block text-[14px] leading-[1.55] text-muted-foreground">
                    {b.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <a
            href="#how"
            className="mt-[30px] self-start text-[16px] font-semibold text-primary transition-colors hover:text-primary/80"
          >
            See how it works
          </a>
        </div>

        {/* The checklist column is the taller block, so the grid's items-center centres the card
            against it on desktop (balanced blocks, no orphan gap below the card). self-center keeps
            the card at its natural height (never stretched); on narrow widths the grid collapses to
            one column and the card simply drops below the text (centring has no effect there). */}
        <div className="self-center">
          <HeroPayoutCard />
        </div>
      </div>
    </section>
  )
}
