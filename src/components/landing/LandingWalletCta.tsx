"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The nav's dynamic Web3 CTA — a small client island that READS wallet +
// subscription state to pick its label, then hands the actual subscribe flow
// off to the dashboard (SubscribeDialog). It composes the shared wallet.ts /
// subscription.ts libs directly and never imports the dashboard's usePayout,
// so the landing and dashboard stay fully separated.
//
// The tron libs pull in tronweb, which can't be evaluated during SSR (the
// dashboard sidesteps this with ssr:false). The landing IS server-rendered, so
// we load those libs via dynamic import() inside the client effect/handler —
// keeping tronweb entirely out of the server render graph.
//
// Nothing here signs or moves funds. State A only requests accounts (a wallet
// permission prompt); States B/C are plain client-side navigation.

type CtaState = "disconnected" | "inactive" | "active"

async function loadTron() {
  const [wallet, subscription] = await Promise.all([
    import("@/lib/tron/wallet"),
    import("@/lib/tron/subscription"),
  ])
  return {
    getWalletProvider: wallet.getWalletProvider,
    getSubscriptionStatus: subscription.getSubscriptionStatus,
  }
}

export function LandingWalletCta({ className }: { className?: string }) {
  const router = useRouter()
  const [state, setState] = useState<CtaState>("disconnected")
  const [connecting, setConnecting] = useState(false)

  // The wallet is NEVER read on mount. `state` starts "disconnected" ("Connect
  // wallet") — exactly what the server renders, so the first client render matches
  // (no hydration gap) — and the injected wallet is only ever touched after the
  // user clicks (handleClick, State A). Reading window.tronWeb on load made
  // TronLink prompt to unlock/reconnect for a previously-authorized wallet; not
  // touching it until a click is what keeps the landing popup-free.
  const label =
    state === "active"
      ? "Go to Dashboard"
      : state === "inactive"
        ? "Subscribe"
        : "Connect Wallet"

  async function handleClick() {
    if (connecting) return

    // State C — subscribed; go to the dashboard.
    if (state === "active") {
      router.push("/dashboard")
      return
    }

    // State B — connected but not subscribed; send them to the pricing section to
    // pick a tier and subscribe (the Pricing "Subscribe" runs the on-chain flow).
    if (state === "inactive") {
      document
        .getElementById("pricing")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }

    // State A — connect inline (permission prompt only; no signing, no funds).
    setConnecting(true)
    try {
      const { getWalletProvider, getSubscriptionStatus } = await loadTron()
      const account = await getWalletProvider("tronlink").connect()
      try {
        const status = await getSubscriptionStatus(account.address)
        setState(status.active ? "active" : "inactive")
      } catch {
        setState("inactive")
      }
    } catch {
      // User rejected, wallet locked, or none installed — stay on "Connect wallet".
    } finally {
      setConnecting(false)
    }
  }

  // `label` derives from `state`, which starts "disconnected" ("Connect wallet")
  // — identical on the server and the first client render, so no hydration gap.
  const shownLabel = connecting ? "Connecting…" : label

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={connecting}
      className={cn(
        "h-auto rounded-[10px] px-[18px] py-2.5 text-[14.5px] font-semibold shadow-[0_1px_2px_rgba(17,16,20,0.08)]",
        className
      )}
    >
      {shownLabel}
    </Button>
  )
}
