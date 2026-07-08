import Link from "next/link"

import { Button } from "@/components/ui/button"

const navLinks = [
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center justify-between gap-x-5 gap-y-3 px-8 py-[15px]">
        <a
          href="#top"
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
          <Link
            href="/dashboard"
            className="text-[14.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Log in
          </Link>
          <Button
            asChild
            className="h-auto rounded-[10px] px-[18px] py-2.5 text-[14.5px] font-semibold shadow-[0_1px_2px_rgba(17,16,20,0.08)]"
          >
            <Link href="/dashboard">Get started</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}
