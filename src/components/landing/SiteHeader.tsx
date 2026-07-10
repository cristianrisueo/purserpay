import { LandingWalletCta } from "./LandingWalletCta"

// Root-relative anchors so the shared header navigates correctly from any route
// (e.g. /legal) — on the landing these stay same-document hash scrolls (no reload).
const navLinks = [
  { label: "Why us", href: "/#why" },
  { label: "How it works", href: "/#how" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQs", href: "/#faq" },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center justify-between gap-x-5 gap-y-3 px-8 py-[15px]">
        <a
          href="/#why"
          className="text-[18px] font-bold tracking-[-0.02em] text-foreground"
        >
          Purser<span className="text-primary">Pay</span>
        </a>

        <nav className="flex flex-wrap items-center gap-x-7 gap-y-2">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[14.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <LandingWalletCta />
        </nav>
      </div>
    </header>
  )
}
