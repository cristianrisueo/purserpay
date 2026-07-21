import { Check, CheckCheck, HelpCircle, LoaderCircle, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import type { RowLine } from "@/lib/security/preflightView"

/**
 * The address cell's single primary line (Sprint UX-2). Honest by state — and there is no grey
 * "Format ok" limbo any more: a well-formed row is either `verifying` (its eager on-chain read is
 * queued/in-flight) or a resolved state. `valid` = "Valid on TRON" now means "passed the on-chain
 * frozen pre-flight, clean" (an owner-decided meaning) — a plain ✓ in aqua, never green; ✓✓
 * "Paid before" stays the one green (paid) signal. `frozen` (a hard red block that replaces this
 * line) is rendered by the column itself, not here.
 */
export function VerifyBadge({ line }: { line: Exclude<RowLine, "frozen"> }) {
  const base =
    "inline-flex items-center gap-1 text-[11.5px] font-medium leading-none"
  switch (line) {
    case "invalid":
      return (
        <span className={cn(base, "text-destructive")}>
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          Invalid address
        </span>
      )
    case "paid-before":
      return (
        <span
          className={cn(base, "text-success")}
          title="You've paid this address before, within the last 3 months."
        >
          <CheckCheck className="size-3.5" aria-hidden="true" />
          Paid before
        </span>
      )
    case "verifying":
      return (
        <span
          className={cn(base, "text-muted-foreground")}
          title="Checking this address against Tether's frozen list on TRON…"
        >
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          Verifying…
        </span>
      )
    case "unverified":
      // D-7 in the UI: couldn't confirm safe → neutral, never green, never blocking.
      return (
        <span
          className={cn(base, "text-muted-foreground")}
          title="Couldn't verify this address right now — it'll be checked again on-chain when you pay."
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
          Unverified
        </span>
      )
    default: // valid
      return (
        <span
          className={cn(base, "text-primary")}
          title="Checked on TRON — not on Tether's frozen list."
        >
          <Check className="size-3.5" aria-hidden="true" />
          Valid on TRON
        </span>
      )
  }
}
