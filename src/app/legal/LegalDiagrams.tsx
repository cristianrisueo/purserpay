import type { ComponentType } from "react"
import { ArrowRight, FileCheck2, Lock, Users, Wallet, X } from "lucide-react"

import { cn } from "@/lib/utils"

// Two sober, self-contained diagrams for /legal, built in the SAME crossed-arrow / boxed-node
// vocabulary the landing already uses (mirrored from components/landing/PrivacyPanels.tsx — the
// vocabulary is re-implemented here, not imported, so no landing component is touched). Server
// component: no client state, no motion, no new runtime deps. Brand tokens only; GREEN is never
// used (paid-only rule) and the severing ✕ is calm muted-ink (a posture statement, not an error).

// One diagram node — a bordered white chip + lucide icon + label + sub-label. `dim` renders the
// "empty" end of a severed flow (dashed, muted); a present node is solid white with an aqua chip.
function DiagramNode({
  icon: Icon,
  label,
  sub,
  dim,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  sub: string
  dim?: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg border px-2.5 py-3 text-center",
        dim
          ? "border-dashed border-border bg-transparent"
          : "border-border bg-card shadow-[0_1px_2px_rgba(17,16,20,0.05)]"
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          dim ? "bg-border/50 text-muted-foreground" : "bg-primary/10 text-primary"
        )}
      >
        <Icon className="size-[17px]" aria-hidden="true" />
      </span>
      <span
        className={cn(
          "text-[12px] font-semibold leading-tight",
          dim ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {label}
      </span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{sub}</span>
    </div>
  )
}

// A SOLID aqua connector: the money genuinely flows this way (wallet → contract → recipients).
function FlowConnector() {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 text-primary"
      aria-hidden="true"
    >
      <span className="h-px w-2.5 bg-primary sm:w-5" />
      <ArrowRight className="size-3.5" />
    </div>
  )
}

// A SEVERED connector: a dashed run cut by an ✕, then an arrowhead — an attempted link that never
// completes. Muted-ink only (never green, never red): the severing is the point, not an alarm.
function SeveredConnector() {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
      aria-hidden="true"
    >
      <span className="h-px w-2 bg-border sm:w-3.5" />
      <span className="flex size-5 items-center justify-center rounded-full border border-muted-foreground/40 bg-card">
        <X className="size-3" strokeWidth={2.5} />
      </span>
      <span className="h-px w-2 bg-border sm:w-3.5" />
      <ArrowRight className="size-3.5" />
    </div>
  )
}

// DIAGRAM 1 — the non-custodial money path. Funds move straight through, wallet → disperse
// contract → recipients (solid aqua). PurserPay sits OFF to the side on a plain DASHED tether
// (no arrowhead — it carries no funds): it prepares the transaction and is never in the flow.
export function NonCustodialFlow() {
  return (
    <figure className="m-0 mt-7 rounded-2xl border border-border bg-bg-band p-5 sm:p-6">
      <div className="flex flex-col items-center">
        {/* The off-to-the-side party — never on the money path. */}
        <div className="rounded-lg border border-dashed border-primary/45 bg-card px-3.5 py-2 text-center shadow-[0_1px_2px_rgba(17,16,20,0.04)]">
          <span className="block text-[12px] font-semibold text-foreground">
            PurserPay
          </span>
          <span className="block text-[10.5px] leading-tight text-muted-foreground">
            prepares the transaction · never in the flow of funds
          </span>
        </div>
        {/* Plain dashed tether — links PurserPay to the path it PREPARES, with no flow direction. */}
        <span
          className="h-5 w-px border-l border-dashed border-muted-foreground/45"
          aria-hidden="true"
        />

        {/* The money path itself — solid aqua, straight through. */}
        <div className="flex w-full items-stretch justify-center gap-1 sm:gap-1.5">
          <DiagramNode icon={Wallet} label="Your wallet" sub="you sign, once" />
          <FlowConnector />
          <DiagramNode
            icon={FileCheck2}
            label="Disperse contract"
            sub="atomic · on-chain"
          />
          <FlowConnector />
          <DiagramNode icon={Users} label="Your recipients" sub="paid directly" />
        </div>
      </div>
      <figcaption className="mt-4 text-center text-[11.5px] leading-[1.5] text-muted-foreground">
        Funds move from your wallet straight to your recipients. PurserPay only prepares the
        transaction — it is never in the flow of funds.
      </figcaption>
    </figure>
  )
}

// DIAGRAM 2 — data dissociation (mirrors landing block 02). The three encrypted billing fields
// are held server-side, but their one-way wallet-hash key is never linked to who you pay.
export function DissociationFlow() {
  return (
    <figure className="m-0 mt-7 rounded-2xl border border-border bg-bg-band p-5 sm:p-6">
      <div className="mx-auto flex max-w-[440px] items-stretch justify-center gap-1.5">
        <DiagramNode icon={Lock} label="Encrypted billing" sub="name · country · tax ID" />
        <SeveredConnector />
        <DiagramNode icon={Wallet} label="Who you pay" sub="your payouts" />
      </div>
      <figcaption className="mt-4 text-center text-[11.5px] leading-[1.5] text-muted-foreground">
        Dissociated by design — your billing identity is never linked to your payout activity.
      </figcaption>
    </figure>
  )
}
