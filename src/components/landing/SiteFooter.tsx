const productLinks = [
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto w-full max-w-[1160px] px-8 py-[clamp(44px,6vw,64px)]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-8">
          <div>
            <div className="text-[18px] font-bold tracking-[-0.02em] text-foreground">
              Purser<span className="text-primary">Pay</span>
            </div>
            <p className="mt-3.5 max-w-[32ch] text-[15px] leading-[1.5] text-muted-foreground">
              Serious software for moving real money — quietly, and only with your
              signature.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#93908A]">
              product
            </span>
            {productLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#93908A]">
              contact
            </span>
            <a
              href="https://purserpay.app"
              target="_blank"
              rel="noreferrer"
              className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              purserpay.app
            </a>
            <a
              href="mailto:crew@purserpay.app"
              className="text-[14.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              crew@purserpay.app
            </a>
          </div>
        </div>

        <div className="mt-9 mb-5 h-px bg-border" />

        <div className="flex flex-wrap justify-between gap-4">
          <span className="font-mono text-[11px] text-[#93908A]">
            © 2026 PurserPay · Non-custodial. You sign. You hold the keys.
          </span>
          <span className="font-mono text-[11px] text-[#93908A]">
            TRON · USDT (TRC20)
          </span>
        </div>
      </div>
    </footer>
  )
}
