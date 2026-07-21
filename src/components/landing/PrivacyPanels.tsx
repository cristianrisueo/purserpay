import type { ComponentType, ReactNode } from "react"
import { ArrowRight, Database, Lock, Server, Wallet, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { privacyPanels, type PrivacyPanel } from "./content"

// Module 02's visual (#how — "Your data isn't our business. Your privacy is."): two side-by-side
// panels, each stating one honest privacy truth and drawing it as a two-node "severed-flow"
// micro-diagram. Panel 1 — the 99% (roster/CSV/history) is device-local and never makes the trip
// to our servers. Panel 2 — the 1% (the three billing fields) IS held server-side, but encrypted at
// rest and DISSOCIATED: its one-way wallet-hash key is never linked to who you pay (Variant C —
// see content.tsx + src/app/actions/compliance.ts + supabase/migrations/0001_compliance_schema.sql).
// GREEN is never used here (paid-only rule) and the ✕ is calm muted-ink — this severing is a
// privacy WIN, not an error, so the diagram carries no alarm colour (no red either). Static,
// server-safe — no client state, no motion. Copy lives in content.tsx; the diagram markup is
// structural and lives here (same split as ProofBothSides / DefenseCards).

// One diagram node — a boxed icon + label + sub-label. `dim` renders the "empty" end of a severed
// flow (dashed, muted); a present node is solid white with an aqua icon chip.
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
      <span className="text-[10.5px] leading-tight text-muted-foreground">
        {sub}
      </span>
    </div>
  )
}

// The severed connector: a dashed run cut by an ✕, then an arrowhead — an attempted flow that
// never completes. Muted-ink only (never green, never red).
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

// A whole micro-diagram: left node → severed connector → right node, with a one-line caption that
// says the point in words (the crossed arrow is the message; the caption removes any ambiguity).
function SeveredFlow({
  left,
  right,
  caption,
}: {
  left: ReactNode
  right: ReactNode
  caption: string
}) {
  return (
    <div className="mt-auto rounded-xl border border-border bg-bg-band p-3.5">
      <div className="flex items-stretch justify-center gap-1.5">
        {left}
        <SeveredConnector />
        {right}
      </div>
      <p className="mt-3 text-center text-[11px] font-medium text-muted-foreground">
        {caption}
      </p>
    </div>
  )
}

// Each panel's diagram, keyed by panel id so the copy (content.tsx) and the visual stay decoupled.
const DIAGRAMS: Record<PrivacyPanel["id"], ReactNode> = {
  local: (
    <SeveredFlow
      left={
        <DiagramNode icon={Database} label="Your browser" sub="roster · CSV · history" />
      }
      right={<DiagramNode icon={Server} label="Our servers" sub="nothing" dim />}
      caption="Your data never makes the trip."
    />
  ),
  billing: (
    <SeveredFlow
      left={
        <DiagramNode icon={Lock} label="Encrypted billing" sub="name · country · tax ID" />
      }
      right={<DiagramNode icon={Wallet} label="Who you pay" sub="your payouts" />}
      caption="Dissociated — your identity is never linked to your payouts."
    />
  ),
}

function Panel({ panel }: { panel: PrivacyPanel }) {
  return (
    <figure className="m-0 flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(17,16,20,0.04),0_18px_40px_-30px_rgba(17,16,20,0.22)]">
      <figcaption className="text-[15px] font-semibold text-foreground">
        {panel.title}
      </figcaption>
      <p className="mt-2.5 mb-5 text-[13.5px] leading-[1.55] text-muted-foreground">
        {panel.body}
      </p>
      {DIAGRAMS[panel.id]}
    </figure>
  )
}

export function PrivacyPanels() {
  return (
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-7">
      {privacyPanels.map((panel) => (
        <Panel key={panel.id} panel={panel} />
      ))}
    </div>
  )
}
