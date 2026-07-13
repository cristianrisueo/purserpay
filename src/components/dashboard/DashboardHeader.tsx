import { useState } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatLongDate, formatUsdt, truncateAddress } from "@/lib/format"
import type { PurserError } from "@/lib/tron/errors"
import type { WalletAccount } from "@/lib/tron/wallet"

type DashboardHeaderProps = {
  connected: boolean
  wrongNetwork: boolean
  networkName: string
  account: WalletAccount | null
  balance: number | null
  /** On-chain subscription expiry in ms since epoch (the SOLE source of truth for
   *  paid time), or null when unknown / no sub. */
  subscriptionExpiresAt: number | null
  /** Off-chain referral-credit window end (ISO), or null. Supabase's domain — used
   *  ONLY to show a running free month, never as paid-time truth. */
  creditActiveUntil?: string | null
  /** Banked referral months awaiting consumption (0 until the summary resolves). */
  monthsBanked?: number
  /** True when the connected wallet has no active subscription (free tier). */
  freeMode: boolean
  walletError: PurserError | null
  onConnect: () => void
  onDisconnect: () => void
  /** Opens the SubscribeDialog (the free-mode "unlock full features" prompt). */
  onSubscribe: () => void
}

export function DashboardHeader({
  connected,
  wrongNetwork,
  networkName,
  account,
  balance,
  subscriptionExpiresAt,
  creditActiveUntil,
  monthsBanked,
  freeMode,
  walletError,
  onConnect,
  onDisconnect,
  onSubscribe,
}: DashboardHeaderProps) {
  // THE single place entitlement is stated — one line the user never has to reconcile.
  // Paid time is read from the ON-CHAIN expiry (subscriptionExpiresAt); a running free
  // month uses the off-chain credit window (Supabase); banked months are a suffix. Snapshot
  // the clock once (lazy init, render-pure — matches FreeTierBanner), these are day-scale.
  const [now] = useState(() => Date.now())
  const subActive = subscriptionExpiresAt != null && subscriptionExpiresAt > now
  const creditMs =
    creditActiveUntil != null ? new Date(creditActiveUntil).getTime() : null
  const creditRunning = !subActive && creditMs != null && creditMs > now
  const banked = monthsBanked ?? 0
  const bankedSuffix =
    banked > 0 ? ` · +${banked} month${banked === 1 ? "" : "s"} banked` : ""

  // Same "Month day, year" format as the payout title (formatLongDate), so every date
  // reads identically. `banked > 0` alone (nothing running, on-chain expired) is a
  // lapsed referrer living on banked months — entitled, but with no clock to date, so
  // we state the count, never a fabricated end date, and never the "Subscribe" CTA.
  const entitlementLine = subActive
    ? `Active until ${formatLongDate(subscriptionExpiresAt!)}${bankedSuffix}`
    : creditRunning
      ? `Active until ${formatLongDate(creditMs!)} (free month)${bankedSuffix}`
      : banked > 0
        ? `${banked} free month${banked === 1 ? "" : "s"} banked`
        : null

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-4 px-6 py-3.5 md:px-8">
        <Link
          href="/"
          className="text-[18px] font-bold tracking-[-0.02em] text-foreground"
        >
          Purser<span className="text-primary">Pay</span>
        </Link>

        {connected && account ? (
          <div className="flex items-center gap-2">
            {wrongNetwork ? (
              <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] font-medium text-destructive">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Wrong network — switch to {networkName}
              </span>
            ) : null}
            {entitlementLine ? (
              <span className="mr-4 text-sm text-muted-foreground">
                {entitlementLine}
              </span>
            ) : freeMode ? (
              <button
                type="button"
                onClick={onSubscribe}
                className="mr-4 text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Subscribe to unlock full features
              </button>
            ) : null}
            <div className="flex items-center gap-2 rounded-[10px] border border-border bg-card py-2 pr-2 pl-3">
              <span
                className="size-1.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span className="font-mono text-[12px] text-foreground">
                {account.provider}
              </span>
              <span className="hidden text-border sm:inline">·</span>
              <span className="hidden font-mono text-[12px] text-muted-foreground sm:inline">
                {truncateAddress(account.address)}
              </span>
              <span className="text-border">·</span>
              <span className="font-mono text-[12px] font-semibold text-foreground">
                {balance != null ? `${formatUsdt(balance)} USDT` : "—"}
              </span>
              <button
                type="button"
                onClick={onDisconnect}
                className="ml-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={() => onConnect()}
              className="h-auto rounded-[10px] px-4 py-2.5 text-[14px] font-semibold"
            >
              Connect wallet
            </Button>
            {walletError ? (
              <span className="max-w-[240px] text-right text-[11.5px] text-destructive">
                {walletError.message}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </header>
  )
}
