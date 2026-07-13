"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The nav's dynamic Web3 CTA — a small client island that READS wallet +
// subscription state to pick its label, then routes to the dashboard (or connects).
// It composes the shared wallet.ts / subscription.ts libs directly and never imports
// the dashboard's usePayout, so the landing and dashboard stay fully separated.
//
// The tron libs pull in tronweb, which can't be evaluated during SSR (the dashboard
// sidesteps this with ssr:false). The landing IS server-rendered, so we load those
// libs via dynamic import() inside the client effect/handler — keeping tronweb
// entirely out of the server render graph.
//
// HYDRATION: on mount we re-read the connection SILENTLY via getAddress() (which
// reads the already-authorized window.tronWeb address and NEVER prompts) and resolve
// entitlement — so a connected user returning to "/" (e.g. via the wordmark) sees
// their real state, not "Connect Wallet". We start in "resolving" (a neutral state
// that matches the server render), so an already-connected user never sees a
// "Connect Wallet" flash. connect() (the only prompt) runs only on an explicit click.

type CtaState = "resolving" | "disconnected" | "inactive" | "active"

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
  const [state, setState] = useState<CtaState>("resolving")
  const [connecting, setConnecting] = useState(false)

  // Silently resolve the current wallet + entitlement. NEVER prompts: getAddress()
  // only reads the already-authorized injected address. A subscription read failure
  // falls back to "inactive" (connected → the free-mode dashboard), never a block.
  const resolve = useCallback(async () => {
    const { getWalletProvider, getSubscriptionStatus } = await loadTron()
    const address = getWalletProvider("tronlink").getAddress()
    if (!address) return "disconnected" as const
    try {
      const status = await getSubscriptionStatus(address)
      return status.active ? ("active" as const) : ("inactive" as const)
    } catch {
      return "inactive" as const
    }
  }, [])

  // Mount hydration + react to later account/network changes (late injection, switch,
  // disconnect). Deferred to a microtask so the first render isn't mutated synchronously
  // and the injected wallet has a tick to appear.
  const connectingRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    const run = () => {
      // Don't clobber the explicit connect flow's own state updates.
      if (connectingRef.current) return
      void resolve().then((next) => {
        if (!cancelled) setState(next)
      })
    }
    void Promise.resolve().then(run)

    let unsub = () => {}
    void import("@/lib/tron/wallet").then(({ getWalletProvider }) => {
      if (cancelled) return
      unsub = getWalletProvider("tronlink").onChange(run)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [resolve])

  const label =
    state === "active"
      ? "Go to Dashboard"
      : state === "inactive"
        ? "Go to Dashboard"
        : state === "disconnected"
          ? "Connect Wallet"
          : "" // resolving — a neutral state, never "Connect Wallet"

  async function handleClick() {
    if (connecting || state === "resolving") return

    // Connected (subscribed or free) → the dashboard. The dashboard's own guard admits
    // any connected wallet; free-mode users land in the 1-payee flow.
    if (state === "active" || state === "inactive") {
      router.push("/dashboard")
      return
    }

    // Disconnected → connect inline (the ONLY prompt; no signing, no funds).
    setConnecting(true)
    connectingRef.current = true
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
      // User rejected, wallet locked, or none installed — back to "Connect Wallet".
      setState("disconnected")
    } finally {
      setConnecting(false)
      connectingRef.current = false
    }
  }

  const resolving = state === "resolving"
  const busy = connecting || resolving

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy}
      className={cn(
        "h-auto min-w-[136px] rounded-[10px] px-[18px] py-2.5 text-[14.5px] font-semibold shadow-[0_1px_2px_rgba(17,16,20,0.08)]",
        className
      )}
    >
      {connecting ? (
        "Connecting…"
      ) : resolving ? (
        <Loader2 className="mx-auto size-4 animate-spin" aria-hidden="true" />
      ) : (
        label
      )}
    </Button>
  )
}
