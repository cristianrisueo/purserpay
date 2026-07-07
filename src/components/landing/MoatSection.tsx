import { Fragment } from "react"

import { cn } from "@/lib/utils"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { moatFlow } from "./content"

export function MoatSection() {
  return (
    <Section className="py-[clamp(60px,8vw,110px)]">
      <Eyebrow className="mb-4">the moat</Eyebrow>
      <h2 className="mb-[18px] max-w-[16ch] text-[clamp(2rem,4.4vw,3.3rem)] font-bold leading-[1.04] tracking-[-0.028em] text-foreground">
        Your keys. Your wallet. <span className="text-primary">Your money.</span>
      </h2>
      <p className="mb-[clamp(40px,6vw,64px)] max-w-[58ch] text-[17.5px] leading-[1.65] text-muted-foreground">
        Non-custodial is a plain idea: we never hold your funds, and we never hold
        your keys. Purser handles the part that keeps you up at night — the
        arithmetic and the address-checking — then hands you an unsigned batch. You
        sign it with your own wallet, and the money moves from you to your team. It
        never passes through us, because by design it can't.
      </p>

      <div className="flex flex-wrap items-stretch gap-3.5">
        {moatFlow.map((node, i) => (
          <Fragment key={node.label}>
            <div
              className={cn(
                "rounded-lg border px-[22px] py-6",
                node.variant === "dashed"
                  ? "min-w-[180px] flex-[1.15] border-dashed border-primary bg-primary/[0.03]"
                  : node.variant === "end"
                    ? "min-w-[170px] flex-1 border-primary/40 bg-primary/[0.05]"
                    : "min-w-[170px] flex-1 border-border bg-card"
              )}
            >
              <span className="font-mono text-[10.5px] tracking-[0.1em] text-primary">
                {node.label}
              </span>
              <p className="mt-3 mb-1 text-[15px] font-semibold text-foreground">
                {node.title}
              </p>
              <p className="text-[13.5px] leading-[1.45] text-muted-foreground">
                {node.body}
              </p>
              {node.badge && (
                <span className="mt-2.5 inline-block rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                  {node.badge}
                </span>
              )}
            </div>
            {i < moatFlow.length - 1 && (
              <div
                aria-hidden
                className="flex items-center text-[18px] text-[#B7B2AB]"
              >
                →
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </Section>
  )
}
