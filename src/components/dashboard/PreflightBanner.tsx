import { Ban, HelpCircle, Landmark } from "lucide-react"

import { cn } from "@/lib/utils"
import type { PreflightSummary } from "@/lib/security/preflightView"

type PreflightBannerProps = {
  /** The security summary of the SELECTED batch (usePayout.preflightSummary). */
  summary: PreflightSummary
}

/**
 * The contextual pre-flight banner, above the table. Renders ONLY when the selected batch has at
 * least one flagged row (`summary.anything`) — a clean batch shows nothing (zero noise). It is a
 * summary AND the color legend in one line: the first time a user sees a red/amber/muted badge in
 * a row, this names what it means. Only the segments with a count appear.
 *
 * Tokens (the visual doctrine): frozen → destructive (red, can't be paid) · exchange → warning
 * (amber, advisory — review) · unverified → muted (advisory). NEVER success/green (green = paid).
 */
export function PreflightBanner({ summary }: PreflightBannerProps) {
  if (!summary.anything) return null

  const seg =
    "inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium"

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] border border-border bg-card px-5 py-3.5">
      <span className="text-[12.5px] font-semibold text-foreground">
        Before you pay:
      </span>

      {summary.frozen > 0 ? (
        <span className={cn(seg, "text-destructive")}>
          <Ban className="size-3.5" aria-hidden="true" />
          {summary.frozen} frozen · can&apos;t be paid
        </span>
      ) : null}

      {summary.exchange > 0 ? (
        <span className={cn(seg, "text-warning")}>
          <Landmark className="size-3.5" aria-hidden="true" />
          {summary.exchange} exchange{" "}
          {summary.exchange === 1 ? "deposit" : "deposits"} · review before paying
        </span>
      ) : null}

      {summary.unverified > 0 ? (
        <span className={cn(seg, "text-muted-foreground")}>
          <HelpCircle className="size-3.5" aria-hidden="true" />
          {summary.unverified} unverified · checked again on-chain when you pay
        </span>
      ) : null}
    </div>
  )
}
