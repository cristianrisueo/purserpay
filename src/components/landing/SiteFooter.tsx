// Compact 3-column footer: brand (left), other links (middle), contact (right),
// over a slim non-custodial notice. Design tokens/colors/borders are unchanged —
// only the density and content are restructured. Both "other links" route to the
// local /privacy disclosures page.
const otherLinks = [
  { label: "Legal info", href: "/legal" },
  { label: "Cookies and privacy policy", href: "/privacy" },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto w-full max-w-[1160px] px-8 py-[clamp(28px,4vw,40px)]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-8">
          {/* Left — brand + tagline */}
          <div className="flex flex-col gap-2">
            <div className="text-[18px] font-bold tracking-[-0.02em] text-foreground">
              Purser<span className="text-primary">Pay</span>
            </div>
            <p className="max-w-[26ch] text-[13.5px] leading-[1.5] text-muted-foreground">
              Non-custodial payouts for distributed teams
            </p>
          </div>

          {/* Middle — other links */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#93908A]">
              other links
            </span>
            {otherLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right — contact */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#93908A]">
              contact
            </span>
            <a
              href="mailto:cristian@sailorlabs.xyz"
              className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              cristian@sailorlabs.xyz
            </a>
            <a
              href="mailto:dorian@sailorlabs.xyz"
              className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              dorian@sailorlabs.xyz
            </a>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <span className="font-mono text-[11px] text-[#93908A]">
            © 2026 PurserPay · Crafted with passion by <a href="https://sailorlabs.xyz" className="text-primary hover:underline">SailorLabs</a> 🌊
          </span>
          <span className="font-mono text-[11px] text-[#93908A]">
            TRON · USDT (TRC20)
          </span>
        </div>
      </div>
    </footer>
  )
}
