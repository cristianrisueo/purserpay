import { NETWORK } from "@/lib/tron/config"

/**
 * A persistent, non-dismissible marker that this is a NON-PRODUCTION (sandbox)
 * build, running on a test network with fake funds.
 *
 * It renders ONLY on a non-mainnet build. The guard reads the INLINED build-time
 * literal `process.env.NEXT_PUBLIC_TRON_NETWORK` (Next replaces it with a string at
 * build), so on a mainnet build the condition folds to `"mainnet" === "mainnet"` and
 * the production minifier **dead-code-eliminates** the entire banner — it is physically
 * absent from the bundle, not merely un-rendered. That is the entire point: it can never
 * reach a customer. (This is NOT a second network selection — config.ts remains the sole
 * place the network + addresses resolve; this is a pure compile-time display gate. There
 * is no runtime toggle.) The display text still reads NETWORK.name from that single source.
 *
 * Design: brand aqua (the --primary token), unmissable but calm (never red / alarming),
 * and not dismissible. A normal-flow block at the very top of <body>, so it sits above
 * the two sticky headers without overlapping them.
 */
export function SandboxBanner() {
  if (process.env.NEXT_PUBLIC_TRON_NETWORK === "mainnet") return null

  return (
    <div
      role="status"
      className="w-full bg-primary px-4 py-2 text-center text-[13px] font-semibold tracking-[-0.005em] text-primary-foreground"
    >
      SANDBOX — {NETWORK.name}. Test funds only. Nothing here is real.
    </div>
  )
}
