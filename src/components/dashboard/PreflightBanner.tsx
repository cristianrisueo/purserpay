import { Ban, HelpCircle, Landmark } from "lucide-react"

import { cn } from "@/lib/utils"
import type { PreflightSummary } from "@/lib/security/preflightView"

type PreflightBannerProps = {
  /** The security summary of the SELECTED batch (usePayout.preflightSummary). */
  summary: PreflightSummary
}

/**
 * The contextual "before you pay" panel, above the table. Renders ONLY when the selected batch has at
 * least one flagged row (`summary.anything`) — a clean batch shows nothing (zero noise). As of UX-2
 * each flagged category gets its OWN one-line strip that EXPLAINS the consequence (not just a count),
 * shown only when that category has ≥1 row. It doubles as the color legend: the first time a user
 * meets a red/amber/muted badge in a row, this names what it means.
 *
 * Tokens (the visual doctrine): frozen → destructive (red, can't be paid) · exchange → warning
 * (amber, advisory — verify) · unverified → muted (advisory). NEVER success/green (green = paid).
 * Honest wording — exchange coverage is partial (S-2 GAP): "look like", "verify", never a promise.
 */
export function PreflightBanner({ summary }: PreflightBannerProps) {
  if (!summary.anything) return null

  const strip = "flex items-start gap-2 text-[12.5px] leading-relaxed"
  const icon = "mt-[1px] size-3.5 shrink-0"

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card px-5 py-3.5">
      <span className="text-[12.5px] font-semibold text-foreground">
        Before you pay:
      </span>

      {summary.frozen > 0 ? (
        <p className={cn(strip, "text-destructive")}>
          <Ban className={icon} aria-hidden="true" />
          <span>
            <span className="font-semibold">
              {summary.frozen} frozen by Tether
            </span>{" "}
            — paying {summary.frozen === 1 ? "it" : "them"} would be an
            irreversible loss: the funds would not reach the recipient and can&apos;t
            be recovered. Remove {summary.frozen === 1 ? "it" : "them"} to continue.
          </span>
        </p>
      ) : null}

      {summary.exchange > 0 ? (
        <p className={cn(strip, "text-warning")}>
          <Landmark className={icon} aria-hidden="true" />
          <span>
            <span className="font-semibold">
              {summary.exchange} look like exchange deposit{" "}
              {summary.exchange === 1 ? "address" : "addresses"}
            </span>{" "}
            — if the exchange doesn&apos;t credit transfers sent from a contract, the
            payee may not see the funds. Verify before paying.
          </span>
        </p>
      ) : null}

      {summary.unverified > 0 ? (
        <p className={cn(strip, "text-muted-foreground")}>
          <HelpCircle className={icon} aria-hidden="true" />
          <span>
            <span className="font-semibold">
              {summary.unverified} couldn&apos;t be checked
            </span>{" "}
            right now — {summary.unverified === 1 ? "it" : "they"}&apos;ll be
            re-checked on-chain when you pay.
          </span>
        </p>
      ) : null}
    </div>
  )
}
