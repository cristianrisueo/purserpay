import { Check, CheckCheck, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import type { VerifyLevel } from "@/lib/tron/validation"

/** The real double-check. Honest by level — a "format ok" never claims on-chain
 *  proof it doesn't have. ✓ = valid + active on TRON; ✓✓ = paid before. */
export function VerifyBadge({ level }: { level: VerifyLevel }) {
  const base =
    "inline-flex items-center gap-1 text-[11.5px] font-medium leading-none"
  switch (level) {
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
    case "valid":
      return (
        <span
          className={cn(base, "text-primary")}
          title="Active account on TRON."
        >
          <Check className="size-3.5" aria-hidden="true" />
          Valid on TRON
        </span>
      )
    default: // valid-format
      return (
        <span
          className={cn(base, "text-muted-foreground")}
          title="Address format is valid. Connect your wallet to confirm it on TRON."
        >
          <Check className="size-3.5 opacity-60" aria-hidden="true" />
          Format ok
        </span>
      )
  }
}
