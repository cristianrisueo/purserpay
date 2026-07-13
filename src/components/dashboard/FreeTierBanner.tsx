import { useState } from "react"
import { Info } from "lucide-react"

import { Button } from "@/components/ui/button"

type FreeTierBannerProps = {
  /** Cooldown end (ms since epoch) after a used free payout, or null when eligible. */
  cooldownUntil: number | null
  /** Opens the existing SubscribeDialog (runSubscribe, 150 USDT). */
  onSubscribe: () => void
}

/** "in N days" / "in N hours" / "very soon" — calm, never a raw timestamp. */
function untilLabel(cooldownUntil: number, now: number): string {
  const ms = cooldownUntil - now
  if (ms <= 0) return "very soon"
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  if (days > 1) return `in ${days} days`
  const hours = Math.ceil(ms / (60 * 60 * 1000))
  if (hours > 1) return `in ${hours} hours`
  return "in under an hour"
}

/**
 * The free-tier banner. Two calm states (never a scold, never a bare error):
 *   - eligible: "Free tier — 1 payee every 30 days. Subscribe to pay your whole
 *     roster in one signature."
 *   - cooldown: "Next free payout <in N days>" + the same Subscribe CTA.
 * Uses only existing design tokens (aqua primary, card, hairline border, 10–14px
 * radii), matching PayoutControls.
 */
export function FreeTierBanner({ cooldownUntil, onSubscribe }: FreeTierBannerProps) {
  // Capture the clock ONCE at mount (a lazy initializer, never read during render).
  // The cooldown is day-scale, so a per-mount snapshot is plenty — no ticking, no
  // impure render read.
  const [now] = useState(() => Date.now())
  const inCooldown = cooldownUntil != null && cooldownUntil > now

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-primary/25 bg-primary/[0.04] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Info className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-foreground">
            {inCooldown
              ? `Next free payout ${untilLabel(cooldownUntil!, now)}`
              : "Free tier — 1 payee every 30 days"}
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            {inCooldown
              ? "You've used this period's free payout. Subscribe to pay your whole roster in one signature — no waiting, no cap."
              : "Prove it on mainnet with one real payout. Subscribe to pay your whole roster in one signature."}
          </p>
        </div>
      </div>

      <Button
        onClick={onSubscribe}
        className="h-auto shrink-0 rounded-[10px] px-4 py-2.5 text-[14px] font-semibold"
      >
        Subscribe
      </Button>
    </div>
  )
}
