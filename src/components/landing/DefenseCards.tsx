import type { ComponentType } from "react"
import { Check, CheckCheck, Gauge, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"
import { defenseCards, type DefenseCard } from "./content"

// Module 01's visual (#how — "Security and simplicity"): the four checks in a 2×2 grid.
// Each card carries its own icon: ✓ (live), ✓✓ (paid-before), a shield (frozen-guard), and a
// gauge (resource pre-check). Every claim is fidelity-bound to a shipped check (see defenseCards
// in content.tsx). Static, server-safe — no client state, no motion.
//
// Layout: DOM order is A,B,C,D. On desktop the grid flows COLUMN-first over two rows, so the
// left column is A (live) over B (paid-before) and the right column is C (frozen-guard) over
// D (resource-precheck) — putting C, the strongest and only unfalsifiable defense (an on-chain
// require, not an off-chain check), top-right as the first focus after the copy. D (resource
// pre-check) is an OFF-CHAIN pre-flight, so C stays the sole on-chain-enforced card. On mobile the
// grid collapses to one column and stacks A,B,C,D (C before D). GREEN is never used here — the
// paid-only rule — so the focal accent on C is the brand AQUA (--primary), not a new colour.
const ICONS: Record<DefenseCard["id"], ComponentType<{ className?: string }>> = {
  live: Check,
  "paid-before": CheckCheck,
  "frozen-guard": ShieldCheck,
  "resource-precheck": Gauge,
}

// The frozen-guard is the focal card (top-right): the only defense the money physically cannot
// cross (an on-chain require), so it earns a subtle aqua ring + a solid-aqua icon chip.
const FOCAL: DefenseCard["id"] = "frozen-guard"

export function DefenseCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:grid-rows-[auto_auto] md:grid-flow-col">
      {defenseCards.map((c) => {
        const Icon = ICONS[c.id]
        const focal = c.id === FOCAL
        return (
          <div
            key={c.id}
            className={cn(
              "flex flex-col rounded-xl border bg-bg-band p-5",
              focal
                ? "border-primary/40 ring-1 ring-primary/15"
                : "border-border"
            )}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  focal
                    ? "bg-primary/10 text-primary"
                    : "bg-primary/10 text-primary"
                )}
              >
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="text-[15px] font-semibold text-foreground">
                {c.title}
              </span>
            </div>
            <p className="text-[13.5px] leading-[1.55] text-muted-foreground">
              {c.body}
            </p>
          </div>
        )
      })}
    </div>
  )
}
