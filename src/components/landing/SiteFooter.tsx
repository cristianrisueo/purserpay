// Compact 4-column footer: brand (left), other links, contact, and a TRON Builders
// League membership badge (right), over a slim non-custodial notice. Design
// tokens/colors/borders are unchanged — the badge is rebuilt in our own tokens
// (Inter Tight + aqua/ink/hairline); the TRON mark is a desaturated single-color
// inline SVG (never green, never red). Both "other links" route to the local
// disclosures pages.
import { ArrowUpRight } from "lucide-react"

const otherLinks = [
  { label: "Legal info", href: "/legal" },
  { label: "Cookies and privacy policy", href: "/privacy" },
]

// Desaturated, in-token redraw of the TRON geometric mark — a thin wireframe
// triangle/tetrahedron echoing the official badge's watermark. Single-color via
// currentColor (inherits a muted neutral tone, NOT the aqua accent, NEVER green/red),
// following the src/components/Logo.tsx inline-SVG conventions. Not a copy of the
// official red/green artwork.
function TronMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 13 L33 16.5 L19 34 Z" />
      <path d="M7 13 L24 27" />
      <path d="M33 16.5 L24 27" />
    </svg>
  )
}

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

          {/* Contact */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#93908A]">
              contact
            </span>
            <a
              href="mailto:dorian@sailorlabs.xyz"
              className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              dorian@sailorlabs.xyz
            </a>
            <a
              href="mailto:cristian@sailorlabs.xyz"
              className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              cristian@sailorlabs.xyz
            </a>
          </div>

          {/* TRON Builders League membership badge (trust signal).
              Supporting proof, not a co-brand: subordinate to the wordmark,
              membership only (no partnership/endorsement claim). */}
          <a
            href="https://forum.trondao.org/t/tbl-tron-builders-league/31287"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col gap-2 self-start rounded-xl border border-border bg-bg-band p-4 transition-colors hover:border-primary/40"
          >
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#93908A]">
              member of
            </span>
            <span className="flex items-center gap-2">
              <TronMark className="size-[18px] shrink-0 text-muted-foreground/70" />
              <span className="text-[14px] font-medium leading-tight text-foreground transition-colors group-hover:text-primary">
                TRON Builders League
              </span>
              <ArrowUpRight
                className="size-3.5 shrink-0 text-[#93908A] transition-colors group-hover:text-primary"
                aria-hidden="true"
              />
            </span>
          </a>
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
