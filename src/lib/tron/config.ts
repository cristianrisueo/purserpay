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

/** Our ownerless, immutable disperse contract (Nile). This is the deployed
 *  PurseDisperseUsdt; disperse still points here so the working money path is
 *  untouched. */
export const DISPERSE_ADDRESS = "TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x"

/** Sentinel used until the unified PurserPay contract (disperse + subscribe) is
 *  deployed. `isPurserPayDeployed()` compares against this — while it is the
 *  live value the subscription gate is fail-closed: the paywall shows and an
 *  on-chain subscribe surfaces a calm "not deployed yet" message. It is not a
 *  valid TRON address on purpose. */
export const PENDING_DEPLOYMENT_ADDRESS = "T_PENDING_DEPLOYMENT_ADDRESS"

/** The PurserPay contract that carries the on-chain subscription (subscribe /
 *  isSubscriptionActive). NOT deployed yet — placeholder until then. At deploy,
 *  set this AND `DISPERSE_ADDRESS` to the one unified PurserPay address (the
 *  same contract serves both disperse and subscribe). */
export const PURSERPAY_ADDRESS = PENDING_DEPLOYMENT_ADDRESS

/** The flat subscription price in USDT base units (6 decimals). Matches the
 *  immutable contract constant `SUBSCRIPTION_PRICE = 250 * 10**6`. */
export const SUBSCRIPTION_PRICE_UNITS = 250_000_000n

/** The subscription price in whole USDT, for display (e.g. the paywall button). */
export const SUBSCRIPTION_PRICE_USDT = 250

/** The USDT token. On Nile this is our MockUsdtTrc20 (6 decimals, same shape as
 *  real USDT-TRC20). Mainnet swaps this for Tether's real contract. */
export const USDT_ADDRESS = "TSYr24mf1npLVWXAJqsDUo9yQwDCSWpqdt"

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
