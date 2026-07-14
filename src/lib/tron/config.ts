// The single network seam. Everything chain-specific lives here so switching
// to mainnet later is a config change, not a code change. Nothing in this file
// is a secret — these are public contract addresses on a public testnet.

export type TronNetwork = {
  /** Stable short id, persisted with receipts so a payment on one network never
   *  paints a row green on another. */
  key: string
  /** Human name shown in wrong-network copy. */
  name: string
  /** Full node RPC. Used only for the keyless read client (pre-connect). Once
   *  a wallet connects, all reads/writes go through the user's own provider. */
  fullHost: string
  /** Substring matched against the connected provider's host to detect the
   *  wrong network. TronLink exposes no reliable chainId, so we match the host
   *  it's actually talking to (e.g. "nile" in "nile.trongrid.io"). */
  hostMatch: string
  /** Tronscan base for receipt/verification links (Sprint 3D). */
  explorer: string
}

/** Sentinel for the pre-deployment state. `isPurserPayDeployed()` compares
 *  against this — while PURSERPAY_ADDRESS equals it, the subscription gate is
 *  fail-closed (paywall shows; an on-chain subscribe surfaces a calm "not
 *  deployed yet"). It can never silently open. It is not a valid TRON address on
 *  purpose. Nile is deployed (so its block below carries a real address); mainnet
 *  is NOT yet, so the mainnet block points here until the deploy runbook lands. */
export const PENDING_DEPLOYMENT_ADDRESS: string = "T_PENDING_DEPLOYMENT_ADDRESS"

/** A full per-network configuration. Exactly one is selected at BUILD time by
 *  NEXT_PUBLIC_TRON_NETWORK — network + contract + USDT move together, so a build
 *  can never mix (e.g.) mainnet USDT with the Nile contract. */
type NetworkConfig = {
  network: TronNetwork
  /** The unified PurserPay contract (disperse + subscribe). PENDING_DEPLOYMENT_ADDRESS
   *  until a real deploy lands, which keeps the subscription gate fail-closed. */
  purserPay: string
  /** USDT-TRC20 token the contract pulls from — MUST equal the deployed PurserPay's
   *  `usdt` immutable, or every approve/subscribe/disperse reverts. */
  usdt: string
}

// --- Nile testnet (deployed) ------------------------------------------------
// The unified PurserPay contract (disperse + subscribe); its disperse/Dispersed/error
// selectors are byte-for-byte preserved from the prior PurseDisperseUsdt, so the money
// path is untouched. disperse is permissionless + immutable; the owner controls ONLY the
// subscription fees + the treasury destination — never funds, keys, broadcast, or disperse.
// Constructor: usdt = TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf (Nile USDT, Tether USD, 6dp),
// treasuryWallet = owner = TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2 (deployer). Fees at deploy:
// 150 / 1,500. Deploy tx: 2167ed646bda86e87ed3b8e4abc064f9a88020a2ad5515f0692e123f4ed2886d.
// (Superseded deploys — do not reuse: TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82 wrong token;
// TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x disperse-only; THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c old
// price 250/2,500; TXFZ2f4DDWB35zLyLLMPErKQyjoz9S1nEY immutable fees.)
const NILE: NetworkConfig = {
  network: {
    key: "nile",
    name: "Nile testnet",
    fullHost: "https://nile.trongrid.io",
    hostMatch: "nile",
    explorer: "https://nile.tronscan.org",
  },
  purserPay: "TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG",
  usdt: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
}

// --- TRON mainnet (NOT yet deployed) ----------------------------------------
// purserPay stays the fail-closed sentinel until the mainnet deploy runbook sets the
// real address. usdt is Tether's REAL USDT-TRC20 — verified character-by-character
// against Tronscan; it MUST equal the deployed contract's `usdt` immutable.
const MAINNET: NetworkConfig = {
  network: {
    key: "mainnet",
    name: "TRON mainnet",
    fullHost: "https://api.trongrid.io",
    hostMatch: "api.trongrid",
    explorer: "https://tronscan.org",
  },
  purserPay: PENDING_DEPLOYMENT_ADDRESS,
  usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
}

const CONFIGS: Record<string, NetworkConfig> = { nile: NILE, mainnet: MAINNET }

// THE network seam. ONE build-time env var selects the WHOLE block (network + both
// addresses + USDT). It is read here, once — client code AND serverRead.ts import these
// same resolved constants, so the client and server can never target different networks.
// Fail closed: a missing or unrecognized value THROWS at module load — never a silent
// default, never a guessed network. There is deliberately NO runtime toggle (a client
// switch would desync from the server, and Supabase is one project keyed on wallet_hash
// with no network dimension, so sandbox traffic would write into the production DB) —
// network isolation comes from a SEPARATE deployment. See docs/06.
const NETWORK_KEY = process.env.NEXT_PUBLIC_TRON_NETWORK
const SELECTED: NetworkConfig | undefined = NETWORK_KEY
  ? CONFIGS[NETWORK_KEY]
  : undefined
if (!SELECTED) {
  throw new Error(
    `NEXT_PUBLIC_TRON_NETWORK must be one of: ${Object.keys(CONFIGS).join(" | ")} — ` +
      `got ${JSON.stringify(NETWORK_KEY)}. Set it in .env.local (build-time only; ` +
      `there is no runtime network toggle).`
  )
}

/** The active network. Resolved from NEXT_PUBLIC_TRON_NETWORK at build time. */
export const NETWORK: TronNetwork = SELECTED.network

/** The deployed PurserPay contract (disperse + subscribe / isSubscriptionActive). One
 *  unified contract serves both; DISPERSE_ADDRESS points at the same address. Equals
 *  PENDING_DEPLOYMENT_ADDRESS on mainnet until the deploy runbook lands (gate fail-closed). */
export const PURSERPAY_ADDRESS: string = SELECTED.purserPay

/** Alias of PURSERPAY_ADDRESS — the same contract carries the money path. */
export const DISPERSE_ADDRESS: string = SELECTED.purserPay

/** Subscription plan selector — matches the contract's `subscribe(uint8 planType)`.
 *  0 = monthly (150 / 30d), 1 = annual (1,500 / 365d). */
export type SubscriptionPlan = 0 | 1

/** The monthly (plan 0) price in USDT base units (6 decimals). Matches the immutable
 *  contract constant `SUBSCRIPTION_PRICE = 150 * 10**6`. */
export const SUBSCRIPTION_PRICE_UNITS = 150_000_000n

/** The monthly (plan 0) price in whole USDT, for display (e.g. the paywall button). */
export const SUBSCRIPTION_PRICE_USDT = 150

/** The annual (plan 1) price in USDT base units. Matches `SUBSCRIPTION_PRICE_ANNUAL`. */
export const SUBSCRIPTION_PRICE_ANNUAL_UNITS = 1_500_000_000n

/** The annual (plan 1) price in whole USDT, for display. */
export const SUBSCRIPTION_PRICE_ANNUAL_USDT = 1500

/** Base units for a plan. */
export function priceUnitsForPlan(plan: SubscriptionPlan): bigint {
  return plan === 1 ? SUBSCRIPTION_PRICE_ANNUAL_UNITS : SUBSCRIPTION_PRICE_UNITS
}

/** The USDT token the contract pulls from — MUST equal the deployed PurserPay's
 *  `usdt` immutable, or on-chain approvals land on the wrong token and every
 *  subscribe/disperse reverts. Resolved from the selected network block: Nile USDT
 *  (Tether USD, 6dp) at TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf, or the real mainnet
 *  Tether USDT-TRC20 at TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t. */
export const USDT_ADDRESS = SELECTED.usdt

/** USDT-TRC20 has 6 decimals. The contract does zero decimal math — the
 *  frontend converts human amounts to base units before dispersing. */
export const USDT_DECIMALS = 6

/** Hard cap on recipients per disperse signature. Derived in the measurement
 *  sprint from the 80ms-CPU consensus ceiling (with margin under the observed
 *  ~100–150 practical max for real USDT). Rosters larger than this are split
 *  into ceil(N/CAP) separate, each-atomic disperse signatures. This is a
 *  signing boundary, never a partial-pay boundary. */
export const BATCH_CAP = 100

// --- feeLimit sizing --------------------------------------------------------
// ⚠ NILE-MEASURED. Every constant below was measured against the Nile testnet
// (mock USDT) in the 3B-measure sprint. Mainnet USDT-TRC20 and mainnet energy
// prices differ, so these are NOT valid for a mainnet payout as-is.
//
// TODO(mainnet-deploy-runbook, docs/06 "Calibrating energy on mainnet"): after the
// mainnet contract is deployed, run ONE small real batch (2–3 recipients), read the
// exact energy consumed from Tronscan, and re-tune ENERGY_BASE /
// ENERGY_PER_RECIPIENT_FRESH / ENERGY_PRICE_SUN from that. feeLimit is a CEILING, not
// a charge — the tx only burns what it uses, so an over-generous value is safe while
// an under-generous one kills a real payroll with OUT_OF_ENERGY. (The old measure.cjs
// script is broken/retired — empirical on-chain measurement supersedes it.)
//
// Sizing rationale (unchanged): a fresh (never-funded) recipient costs the most
// energy; funded recipients ~half. We size feeLimit against the fresh worst case so a
// batch never dies OUT_OF_ENERGY.
export const ENERGY_BASE = 3_000 // NILE: per-tx overhead (measured ~2,919)
export const ENERGY_PER_RECIPIENT_FRESH = 30_300 // NILE: measured ~30,255, rounded up
export const ENERGY_PRICE_SUN = 100 // NILE energy price (sun per energy) — mainnet differs
export const FEE_MARGIN = 1.5 // headroom over the fresh estimate
export const FEE_FLOOR_SUN = 50_000_000 // 50 TRX floor for tiny batches
export const SUN_PER_TRX = 1_000_000

/** Safe feeLimit (in sun) for a disperse of `recipientCount` recipients,
 *  sized against the all-fresh worst case with margin. Always well under the
 *  15,000 TRX network max. */
export function feeLimitForBatch(recipientCount: number): number {
  const energy = ENERGY_BASE + ENERGY_PER_RECIPIENT_FRESH * recipientCount
  const sun = Math.ceil(energy * FEE_MARGIN) * ENERGY_PRICE_SUN
  return Math.max(sun, FEE_FLOOR_SUN)
}

/** How far back the "paid before" (✓✓) check looks in the operator's own
 *  on-chain history. */
export const HISTORY_WINDOW_DAYS = 90

/** Tronscan transaction link for a txid. */
export function txExplorerUrl(txid: string): string {
  return `${NETWORK.explorer}/#/transaction/${txid}`
}
