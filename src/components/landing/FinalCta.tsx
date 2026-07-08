import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"

export function FinalCta() {
  return (
    <Section className="py-[clamp(64px,8vw,104px)] text-center">
      <Eyebrow className="mb-5">a calmer payday</Eyebrow>
      <h2 className="mx-auto mb-5 max-w-[16ch] text-[clamp(2.1rem,5.2vw,4rem)] font-bold leading-[1.02] tracking-[-0.03em] text-foreground">
        Pay everyone in <span className="text-primary">one transfer.</span>
      </h2>
      <p className="mx-auto mb-[34px] max-w-[46ch] text-[clamp(16.5px,1.7vw,19px)] leading-[1.55] text-muted-foreground">
        We do the arithmetic. We check every address. We hand you the batch. You
        sign — and the money never touches our hands.
      </p>
      <Button
        asChild
        className="h-auto rounded-[12px] px-8 py-[17px] text-[16px] font-semibold shadow-[0_12px_30px_-14px_rgba(15,181,201,0.6)]"
      >
        <Link href="/dashboard">Get started</Link>
      </Button>
    </Section>
  )
}
