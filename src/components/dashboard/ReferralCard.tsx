"use client"

import { useState } from "react"
import { Check, Copy, Gift } from "lucide-react"

import { Button } from "@/components/ui/button"

type ReferralCardProps = {
  /** The wallet's opaque referral code (the share link is {origin}/r/{code}). */
  code: string
  /** Banked free months awaiting consumption. */
  monthsBanked: number
  /** Invited wallets that have paid their first month. */
  qualifiedReferrals: number
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/**
 * The referral card — only shown to ENTITLED wallets (a subscriber or a wallet on
 * credit); a pure free-tier wallet sees the subscribe CTA instead. Existing tokens
 * only. Honest by construction: the invitee gets nothing, the referrer gets 30 days
 * per first paid referral. ≤3 clicks (copy is one).
 */
export function ReferralCard({
  code,
  monthsBanked,
  qualifiedReferrals,
}: ReferralCardProps) {
  // Origin captured once (lazy init, render-pure) for the share link. Entitlement
  // (paid time / running credit) is stated by DashboardHeader — the card is referrals
  // only, so no clock or subscription date lives here anymore.
  const [origin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  )
  const [copied, setCopied] = useState(false)

  const link = `${origin}/r/${code}`
  const displayLink = link.replace(/^https?:\/\//, "")

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked (permissions / insecure origin) — no-op, link stays visible */
    }
  }

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Gift className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[14px] font-semibold text-foreground">
              Get 30 days
            </h2>
            <span className="text-[12.5px] text-muted-foreground">
              {plural(qualifiedReferrals, "qualified referral")} ·{" "}
              {plural(monthsBanked, "free month")} banked
            </span>
          </div>

          {/* The share link + one-click copy (≤3 clicks). */}
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-[12.5px] text-foreground">
              {displayLink}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={copy}
              className="h-auto shrink-0 rounded-[10px] px-3 py-2 text-[13px] font-medium"
              aria-label="Copy your referral link"
            >
              {copied ? (
                <>
                  <Check className="mr-1.5 size-3.5 text-success" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </Button>
          </div>

          <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <b>Share your link. When someone you invited pays for their first month,
            you get 1 month free.</b>
          </p>

          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Banked months never expire. Yours is applied the next time you pay a batch after your paid
            time runs out — and the 30 days start from that moment.
          </p>
        </div>
      </div>
    </div>
  )
}
