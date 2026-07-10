"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { pricingBullets, pricingTiers } from "./content"

// Bloque 5 — pricing (#pricing). Two on-chain USDT tiers, settled through the
// PurserPay contract. No fiat, no card. You pick a tier (the cards toggle), then
// "Subscribe" connects the wallet if needed and runs the on-chain subscribe with
// the user's OWN wallet — Purser never holds a key or broadcasts on your behalf.
//
// SSR-safe: this is a client island, but the tron libs pull in tronweb (which
// can't be evaluated during SSR), so they're loaded via dynamic import() inside
// the click handler — never at module scope, never on mount. Nothing chain-side
// runs until the user clicks Subscribe.
//
// On-chain reality: the contract exposes only a flat monthly subscribe() (250
// USDT). There's no annual method yet, so the Annual tier's price is selection +
// display; runSubscribe always signs the flat path. And the contract isn't
// deployed, so today a subscribe surfaces a calm, honest "not deployed yet".

async function loadTron() {
  const [wallet, subscription] = await Promise.all([
    import("@/lib/tron/wallet"),
    import("@/lib/tron/subscription"),
  ])
  return {
    getWalletProvider: wallet.getWalletProvider,
    runSubscribe: subscription.runSubscribe,
  }
}

/** Calm message from any thrown value — connect()/runSubscribe() throw PurserError. */
function messageFor(e: unknown): string {
  return e instanceof Error && e.message
    ? e.message
    : "Something went wrong — nothing was signed. Please try again."
}

export function PricingSection() {
  // Default the Annual tier active (the best-value one flagged in content).
  const [selected, setSelected] = useState(
    () => pricingTiers.find((t) => t.highlight)?.name ?? pricingTiers[0].name
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleSubscribe() {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      const { getWalletProvider, runSubscribe } = await loadTron()
      const tronlink = getWalletProvider("tronlink")

      // 1) Ensure a connected wallet — prompt only if we don't have one.
      let address = tronlink.getAddress()
      if (!address) {
        setStatus("Connecting your wallet…")
        const account = await tronlink.connect()
        address = account.address
      }

      // 2) Build + trigger the subscribe tx from the user's own wallet, on the
      //    active tier's plan (0 = monthly, 1 = annual). Today this fail-closes
      //    honestly (contract not deployed yet).
      const plan = pricingTiers.find((t) => t.name === selected)?.plan ?? 0
      setStatus("Confirm the subscription in your wallet…")
      await runSubscribe(address, plan, {
        onApproveStart: () => setStatus("Approving USDT to PurserPay…"),
        onSigning: () => setStatus("Confirm the subscription in your wallet…"),
        onConfirming: () => setStatus("Confirming on-chain…"),
      })
      setStatus("Subscription active — you're all set.")
    } catch (e) {
      setStatus(messageFor(e))
    } finally {
      setBusy(false)
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
            onClick={handleSubscribe}
            disabled={busy}
            className="mt-6 h-auto w-full rounded-[11px] py-4 text-[15.5px] font-semibold shadow-[0_10px_26px_-14px_rgba(15,181,201,0.55)]"
          >
            Subscribe
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
    </Section>
  )
}
