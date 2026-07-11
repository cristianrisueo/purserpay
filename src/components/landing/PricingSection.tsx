"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SubscribeDialog } from "@/components/dashboard/SubscribeDialog"
import { storeBillingProfile } from "@/app/actions/compliance"
import {
  NETWORK,
  SUBSCRIPTION_PRICE_ANNUAL_USDT,
  SUBSCRIPTION_PRICE_USDT,
} from "@/lib/tron/config"
import { humanize, type PurserError } from "@/lib/tron/errors"
import type { BillingPii, SubscribePhase } from "@/hooks/usePayout"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { pricingBullets, pricingTiers } from "./content"

// Bloque 5 — pricing (#pricing). Two on-chain USDT tiers, settled through the
// PurserPay contract. No fiat, no card. You pick a tier (the cards toggle), then
// "Subscribe" connects the wallet if needed and opens the billing dialog. Confirm
// and pay stores the encrypted PII server-side, then runs the on-chain subscribe
// with the user's OWN wallet and routes to the dashboard — Purser never holds a
// key or broadcasts on your behalf.
//
// SSR-safe: this is a client island, but the tron libs pull in tronweb (which
// can't be evaluated during SSR), so they're loaded via dynamic import() inside
// the click/submit handlers — never at module scope, never on mount. Nothing
// chain-side runs until the user confirms.
//
// On-chain reality: PurserPay is deployed on Nile and exposes subscribe(uint8
// planType) — 0 = monthly (150 USDT), 1 = annual (1,500 USDT). runSubscribe signs
// the selected plan's path; the PII form is the same dialog the dashboard uses.

async function loadTron() {
  const [wallet, subscription] = await Promise.all([
    import("@/lib/tron/wallet"),
    import("@/lib/tron/subscription"),
  ])
  return {
    getWalletProvider: wallet.getWalletProvider,
    getSubscriptionStatus: subscription.getSubscriptionStatus,
    runSubscribe: subscription.runSubscribe,
  }
}

/** Calm message from any thrown value — connect() throws PurserError. */
function messageFor(e: unknown): string {
  return e instanceof Error && e.message
    ? e.message
    : "Something went wrong — nothing was signed. Please try again."
}

export function PricingSection() {
  const router = useRouter()
  // Default the Annual tier active (the best-value one flagged in content).
  const [selected, setSelected] = useState(
    () => pricingTiers.find((t) => t.highlight)?.name ?? pricingTiers[0].name
  )
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, setPhase] = useState<SubscribePhase>("idle")
  const [subscribeError, setSubscribeError] = useState<PurserError | null>(null)

  // No wallet is read on mount — the injected wallet is only ever touched after the
  // user clicks "Subscribe" (handleSubscribeClick). Reading window.tronWeb on load
  // made TronLink prompt to unlock/reconnect for a previously-authorized wallet.
  // The already-subscribed double-pay guard now runs inside the click handler
  // (check status after connect → route to the dashboard instead of paying again).

  const selectedTier =
    pricingTiers.find((t) => t.name === selected) ?? pricingTiers[0]
  const plan = selectedTier.plan
  const priceUsdt =
    plan === 1 ? SUBSCRIPTION_PRICE_ANNUAL_USDT : SUBSCRIPTION_PRICE_USDT
  const periodLabel = plan === 1 ? "a year" : "a month"

  // Step 1 — "Subscribe": ensure a connected wallet (prompt only if needed), then
  // — if that wallet is already subscribed — route to the dashboard instead of
  // charging again (the double-pay guard, moved here from a mount effect so the
  // wallet is never read on load). Otherwise open the billing dialog; the address
  // is read fresh again at confirm time.
  async function handleSubscribeClick() {
    if (connecting) return
    setConnecting(true)
    setStatus(null)
    try {
      const { getWalletProvider, getSubscriptionStatus } = await loadTron()
      const tronlink = getWalletProvider("tronlink")
      let address = tronlink.getAddress()
      if (!address) {
        setStatus("Connecting your wallet…")
        address = (await tronlink.connect()).address
      }
      // Already subscribed → the dashboard, never a second charge. If the status
      // can't be confirmed on-chain (RPC down), fall through to the dialog — the
      // on-chain subscribe itself is the source of truth (fail-open to paywall).
      try {
        const status = await getSubscriptionStatus(address)
        if (status.active) {
          router.push("/dashboard")
          return
        }
      } catch {
        // Unconfirmable — open the paywall (matches prior behavior).
      }
      setStatus(null)
      setSubscribeError(null)
      setPhase("idle")
      setDialogOpen(true)
    } catch (e) {
      setStatus(messageFor(e))
    } finally {
      setConnecting(false)
    }
  }

  // Step 2 — "Confirm and pay": store the encrypted PII server-side FIRST, then run
  // the on-chain subscribe on the selected plan from the user's own wallet, then
  // route to the dashboard. Mirrors usePayout.subscribe (store → subscribe); the
  // landing can't import the dashboard hook, so it's replicated with shared libs.
  async function handleConfirmAndPay(pii: BillingPii) {
    setSubscribeError(null)
    try {
      const { getWalletProvider, runSubscribe } = await loadTron()
      const address = getWalletProvider("tronlink").getAddress()
      if (!address) throw new Error("Connect your wallet to continue.")

      // 1) On-chain subscribe FIRST for the active plan, from the user's own wallet. If
      //    this throws (rejected / no gas / revert) nothing is stored — no orphan PII.
      await runSubscribe(address, plan, {
        onApproveStart: () => setPhase("approving"),
        onSigning: () => setPhase("signing"),
        onConfirming: () => setPhase("confirming"),
      })

      // 2) Paid → encrypted PII → Supabase (server action; never persisted client-side).
      //    Best-effort: the payment already succeeded and the gate is on-chain, so a
      //    store failure must not block the now-paid user or re-open the dialog
      //    (re-clicking would re-charge — runSubscribe isn't idempotent). Swallow + log.
      setPhase("storing")
      try {
        await storeBillingProfile(address, JSON.stringify(pii))
      } catch (storeErr) {
        console.error("PII store failed after a confirmed subscribe:", storeErr)
      }

      // 3) Subscribed → the guard releases the dashboard.
      router.push("/dashboard")
    } catch (e) {
      setSubscribeError(humanize(e))
    } finally {
      setPhase("idle")
    }
  }

  return (
    <Section id="pricing">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-[clamp(36px,5vw,64px)]">
        <div>
          <Eyebrow className="mb-4">pricing</Eyebrow>
          <h2 className="mb-5 max-w-[15ch] text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
            One <span className="text-primary">flat</span> rate. However much you
            move.
          </h2>
          <p className="mb-[18px] max-w-[46ch] text-[16.5px] leading-[1.6] text-muted-foreground">
            Custodial services take{" "}
            <b className="text-foreground">0.5–3.5% of volume</b>. Move $50k a month
            and that's <b className="text-foreground">$250–$1,750</b> — every month,
            and it grows exactly as you do.
          </p>
          <p className="max-w-[46ch] text-[16.5px] leading-[1.6] text-foreground">
            <b>A flat on-chain fee wins the moment you're serious.</b> You pay the
            same whether you move $5k or $500k — 0.0% app fees, uncapped
            volume.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-[clamp(28px,3.5vw,38px)] shadow-[0_1px_2px_rgba(17,16,20,0.04),0_30px_60px_-38px_rgba(17,16,20,0.3)]">
          <span className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground">
            PurserPay · settled on-chain
          </span>

          <div className="mt-[18px] overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
              {pricingTiers.map((tier) => {
                const active = selected === tier.name
                return (
                  <button
                    key={tier.name}
                    type="button"
                    onClick={() => setSelected(tier.name)}
                    aria-pressed={active}
                    className={cn(
                      "bg-card px-5 py-[22px] text-left transition-colors",
                      active
                        ? "bg-primary/[0.04] ring-1 ring-inset ring-primary"
                        : "hover:bg-bg-band"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-foreground">
                        {tier.name}
                      </span>
                      {tier.highlight && (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">
                          best value
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-baseline gap-1.5">
                      <span className="text-[clamp(2rem,4.4vw,2.6rem)] font-bold leading-[0.9] tracking-[-0.03em] text-foreground">
                        {tier.price}
                      </span>
                      <span className="text-[14px] font-semibold text-muted-foreground">
                        {tier.unit}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[12.5px] text-muted-foreground">
                      {tier.period}
                    </div>
                    {tier.note && (
                      <div className="mt-2.5 text-[12.5px] leading-[1.45] text-foreground">
                        {tier.note}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-[22px] flex flex-col gap-[13px] border-t border-[#EFEDE9] pt-[22px]">
            {pricingBullets.map((bullet) => (
              <span
                key={bullet}
                className="flex gap-2.5 text-[14.5px] text-foreground"
              >
                <span className="font-bold text-primary">✓</span>
                {bullet}
              </span>
            ))}
          </div>

          <Button
            type="button"
            onClick={handleSubscribeClick}
            disabled={connecting}
            className="mt-6 h-auto w-full rounded-[11px] py-4 text-[15.5px] font-semibold shadow-[0_10px_26px_-14px_rgba(15,181,201,0.55)]"
          >
            {connecting ? "Connecting…" : "Subscribe"}
          </Button>

          {status ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-3.5 text-center text-[12.5px] leading-[1.5] text-muted-foreground"
            >
              {status}
            </p>
          ) : (
            <p className="mt-3.5 text-center text-[12.5px] text-muted-foreground">
              Settled through the PurserPay contract · Your keys never leave you
            </p>
          )}
        </div>
      </div>

      {/* Billing dialog — same PII form the dashboard paywall uses. "Confirm and
          pay" stores the encrypted PII, then subscribes on-chain and routes to the
          dashboard. Closing is blocked while a subscription is settling. */}
      <SubscribeDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (phase !== "idle") return
          setDialogOpen(open)
        }}
        onSubscribe={handleConfirmAndPay}
        phase={phase}
        error={subscribeError}
        networkName={NETWORK.name}
        priceUsdt={priceUsdt}
        periodLabel={periodLabel}
      />
    </Section>
  )
}
