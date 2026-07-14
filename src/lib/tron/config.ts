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
 *  purpose. BOTH Nile and mainnet are now deployed (their blocks below carry real
 *  addresses), so this is retained only as the comparison target — the gate is open
 *  on both. Kept for a hypothetical future network block that ships before its deploy. */
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
// 150 / 1,500. Deploy tx: 6e3df940ea64fda7699a60812f4d4f0ae334a081801bd4e2b0f23d73a838f307
// (46.97 TRX / 580,485 energy).
// (Superseded deploys — do not reuse: TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82 wrong token;
// TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x disperse-only; THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c old
// price 250/2,500; TXFZ2f4DDWB35zLyLLMPErKQyjoz9S1nEY immutable fees;
// TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG prior bytecode — immutable treasury, before
// updateTreasuryWallet; deploy tx 2167ed646bda86e87ed3b8e4abc064f9a88020a2ad5515f0692e123f4ed2886d.)
const NILE: NetworkConfig = {
  network: {
    key: "nile",
    name: "Nile testnet",
    fullHost: "https://nile.trongrid.io",
    hostMatch: "nile",
    explorer: "https://nile.tronscan.org",
  },
  purserPay: "TK9z7J4TZBB5UjaFmE8kvNDehdAJFecUnX",
  usdt: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
}

// --- TRON mainnet (deployed) ------------------------------------------------
// The unified PurserPay contract (disperse + subscribe). usdt is Tether's REAL USDT-TRC20 —
// verified char-by-char vs Tronscan AND read back on-chain post-deploy (usdt() == this). It
// MUST equal the deployed contract's `usdt` immutable. disperse is permissionless + immutable;
// the owner controls ONLY the subscription fees + treasury destination.
// Constructor: usdt = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (Tether USD, 6dp),
// treasuryWallet = owner = TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2 (deployer — the HOT key for launch;
// move to cold/multisig via updateTreasuryWallet later, no redeploy — docs/06 §6). Fees at
// deploy: 150 / 1,500. Deploy tx: 4f2bca105f5edbc468e3325fc150b2ef87066a439204b853e3c50bc4cf0a92e5
// (62.71 TRX / 580,485 energy). Was the fail-closed sentinel (PENDING_DEPLOYMENT_ADDRESS) until
// this deploy. NOTE: the code is wired for mainnet, but the PRODUCTION Vercel env flip
// (NEXT_PUBLIC_TRON_NETWORK=mainnet) is still pending — customers are not on mainnet yet.
const MAINNET: NetworkConfig = {
  network: {
    key: "mainnet",
    name: "TRON mainnet",
    fullHost: "https://api.trongrid.io",
    hostMatch: "api.trongrid",
    explorer: "https://tronscan.org",
  },
  purserPay: "TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha",
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
// ✅ MAINNET-MEASURED (2026-07-14). Calibrated by CONSTANT-CALL SIMULATION
// (triggerConstantContract — no signature, no spend) against the LIVE mainnet PurserPay
// TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha with FRESH recipients (never held USDT).
// See scripts/tron/measure-mainnet.cjs and docs/06 §6. LINEAR FIT residual 0.0% on N=2/3/5 —
// the BASE + PER·N model holds exactly:
//   ENERGY_PER_RECIPIENT_FRESH = 157,000  (marginal per fresh recipient)
//   ENERGY_BASE                =   3,100  (per-tx overhead)
//
// ⚠ NILE'S MOCK/TESTNET USDT WAS NOT REPRESENTATIVE of mainnet Tether — a 3.9× MISS: the Nile
// rehearsal read ~36,925/recipient, mainnet reads ~157,000. Never calibrate energy from testnet.
// With the old Nile constant (40,000), the feeLimit budgeted for one fresh recipient (64,568
// energy) was already well under the REAL single-recipient cost (159,946). The 50 TRX floor
// masked it for the smallest batches (N≤3 survived), but a real payroll to 4+ FRESH (virgin)
// wallets would have died OUT_OF_ENERGY (e.g. N=4 real 63 TRX > old feeLimit 50 TRX floor).
// Fresh is the worst case AND the real case (a new affiliate's wallet is virgin); fresh/existing
// ≈ 1.72× (fresh N=3 = 473,747 energy vs existing holders = 275,747), so we size against fresh.
//
// feeLimit is a CEILING, not a charge — the tx burns only what it uses, so over-provisioning
// costs nothing while under-provisioning kills a payroll. At BATCH_CAP=100, feeLimit ≈ 2,355 TRX
// (well under the 15,000 TRX protocol max). Re-verify against a REAL receipt the first mainnet
// batch: getAllowDynamicEnergy=1 on mainnet, so per-contract energy can rise with usage. docs/06 §6.
export const ENERGY_BASE = 3_100 // MAINNET: per-tx overhead (measured 2026-07-14)
export const ENERGY_PER_RECIPIENT_FRESH = 157_000 // MAINNET: fresh recipient (measured; Nile was 3.9× too low)
export const ENERGY_PRICE_SUN = 100 // mainnet getEnergyFee (sun/energy) at calibration — a governance param; re-check
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
