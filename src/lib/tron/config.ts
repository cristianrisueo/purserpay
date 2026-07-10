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

// --- Active network: Nile testnet -------------------------------------------
// Deployed + measured in the 3B-measure sprint. Swap this block (and the two
// addresses below) for mainnet when the time comes; nothing else changes.
export const NETWORK: TronNetwork = {
  key: "nile",
  name: "Nile testnet",
  fullHost: "https://nile.trongrid.io",
  hostMatch: "nile",
  explorer: "https://nile.tronscan.org",
}

// Mainnet, for reference — do NOT enable until V1 ships and the real USDT
// address + a mainnet-deployed disperse are wired and re-measured:
//   name: "TRON mainnet", fullHost: "https://api.trongrid.io",
//   hostMatch: "api.trongrid", explorer: "https://tronscan.org"
//   USDT_ADDRESS (real): TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t

/** Our ownerless, immutable disperse contract (Nile). Now the unified PurserPay
 *  contract (disperse + subscribe) — its disperse/Dispersed/error selectors are
 *  byte-for-byte preserved from the prior PurseDisperseUsdt, so the money path is
 *  untouched. Same address as PURSERPAY_ADDRESS: one contract serves both.
 *  (Superseded deploys: TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82 — wrong token;
 *  TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x — disperse-only.) */
export const DISPERSE_ADDRESS: string = "THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c"

/** Sentinel for the pre-deployment state. `isPurserPayDeployed()` compares
 *  against this — while PURSERPAY_ADDRESS equals it, the subscription gate is
 *  fail-closed (paywall shows; an on-chain subscribe surfaces a calm "not
 *  deployed yet"). PurserPay is now deployed, so this is retained only as the
 *  comparison target. It is not a valid TRON address on purpose. */
export const PENDING_DEPLOYMENT_ADDRESS: string = "T_PENDING_DEPLOYMENT_ADDRESS"

/** The deployed PurserPay contract (Nile) that carries the on-chain subscription
 *  (subscribe / isSubscriptionActive) AND disperse. One unified, ownerless,
 *  immutable contract serves both — DISPERSE_ADDRESS points at the same address.
 *  Constructor immutables: usdt = TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf (Nile USDT,
 *  Tether USD, 6dp), treasuryWallet = TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2.
 *  Deploy tx: df0032eae7d52f6d9e04d3f5628c85e993a62e26367c5f9c05c4151840bc28dd.
 *  (Superseded: TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82 pointed at the wrong token.) */
export const PURSERPAY_ADDRESS: string = "THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c"

/** Subscription plan selector — matches the contract's `subscribe(uint8 planType)`.
 *  0 = monthly (250 / 30d), 1 = annual (2,500 / 365d). */
export type SubscriptionPlan = 0 | 1

/** The monthly (plan 0) price in USDT base units (6 decimals). Matches the immutable
 *  contract constant `SUBSCRIPTION_PRICE = 250 * 10**6`. */
export const SUBSCRIPTION_PRICE_UNITS = 250_000_000n

/** The monthly (plan 0) price in whole USDT, for display (e.g. the paywall button). */
export const SUBSCRIPTION_PRICE_USDT = 250

/** The annual (plan 1) price in USDT base units. Matches `SUBSCRIPTION_PRICE_ANNUAL`. */
export const SUBSCRIPTION_PRICE_ANNUAL_UNITS = 2_500_000_000n

/** The annual (plan 1) price in whole USDT, for display. */
export const SUBSCRIPTION_PRICE_ANNUAL_USDT = 2500

/** Base units for a plan. */
export function priceUnitsForPlan(plan: SubscriptionPlan): bigint {
  return plan === 1 ? SUBSCRIPTION_PRICE_ANNUAL_UNITS : SUBSCRIPTION_PRICE_UNITS
}

/** The USDT token the contract pulls from — MUST equal the deployed PurserPay's
 *  `usdt` immutable, or on-chain approvals land on the wrong token and every
 *  subscribe/disperse reverts. On Nile this is Tether USD (symbol USDT, 6 decimals)
 *  at TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf. (Was the MockUsdtTrc20 TSYr… before the
 *  corrected-token redeploy.) Mainnet swaps this for Tether's mainnet contract. */
export const USDT_ADDRESS = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"

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
// From the Nile measurement: a fresh (never-funded) recipient costs the most
// energy; funded recipients ~half. We size feeLimit against the fresh worst
// case so a batch never dies OUT_OF_ENERGY. feeLimit is a ceiling, not a
// charge — the tx only burns what it actually uses.
export const ENERGY_BASE = 3_000 // per-tx overhead (measured ~2,919)
export const ENERGY_PER_RECIPIENT_FRESH = 30_300 // measured ~30,255, rounded up
export const ENERGY_PRICE_SUN = 100 // Nile energy price (sun per energy)
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
