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

// --- Nile testnet (deployed — S-1 GUARDED build) ----------------------------
// The unified PurserPay contract (disperse + subscribe); its disperse/Dispersed/error
// selectors are byte-for-byte preserved from the prior PurseDisperseUsdt, so the money
// path is untouched. disperse is permissionless + immutable and now carries the S-1
// frozen-address guard (reverts DestinationBlacklisted / SenderBlacklisted, USDT-only via
// UnsupportedToken); the owner controls ONLY the subscription fees + the treasury
// destination — never funds, keys, broadcast, or disperse. NOTE — both networks now run the
// SAME S-1 guarded build: this Nile block shipped in N-1 (2026-07-19, the rehearsal), and the
// MAINNET block below shipped the identical guarded bytecode in S-4 (2026-07-23).
// Constructor: usdt = TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf (Nile USDT, Tether USD, 6dp),
// treasuryWallet = owner = TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2 (deployer). Fees at deploy:
// 150 / 1,500. Deploy tx: 610c560920a1248a829a641fd7ebf5446cf00dd2d0332ea14ff558ba683449c4
// (55.79 TRX / 668,613 energy — N-1, 2026-07-19; usdt()/owner()/treasury()/prices read back
// on-chain ✓).
// (Superseded deploys — do not reuse: TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82 wrong token;
// TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x disperse-only; THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c old
// price 250/2,500; TXFZ2f4DDWB35zLyLLMPErKQyjoz9S1nEY immutable fees;
// TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG prior bytecode — immutable treasury, before
// updateTreasuryWallet, deploy tx 2167ed646bda86e87ed3b8e4abc064f9a88020a2ad5515f0692e123f4ed2886d;
// TK9z7J4TZBB5UjaFmE8kvNDehdAJFecUnX PRE-GUARD (before S-1), superseded by N-1, deploy tx
// 6e3df940ea64fda7699a60812f4d4f0ae334a081801bd4e2b0f23d73a838f307, 46.97 TRX / 580,485 energy.)
const NILE: NetworkConfig = {
  network: {
    key: "nile",
    name: "Nile testnet",
    fullHost: "https://nile.trongrid.io",
    hostMatch: "nile",
    explorer: "https://nile.tronscan.org",
  },
  purserPay: "TH9vLTjvADpBeJ6E49HrwPerscYGsUU2wb",
  usdt: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
}

// --- TRON mainnet (deployed) ------------------------------------------------
// The unified PurserPay contract (disperse + subscribe). usdt is Tether's REAL USDT-TRC20 —
// verified char-by-char vs Tronscan AND read back on-chain post-deploy (usdt() == this). It
// MUST equal the deployed contract's `usdt` immutable. disperse is permissionless + immutable;
// the owner controls ONLY the subscription fees + treasury destination.
// Constructor: usdt = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (Tether USD, 6dp),
// treasuryWallet = owner = TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2 (deployer — the HOT key for launch;
// move to cold/multisig via updateTreasuryWallet later, no redeploy — docs/06 §6). Fees at deploy:
// 150 / 1,500. GUARDED (S-1) build — deploy tx
// 8572f2896637ae36ca0b0827b1644def5ded30f641c9c2ee1fdf75101d03c316 (2026-07-23; 668,613 energy,
// 0 TRX for energy via delegation + ~5.248 TRX bandwidth; usdt()/treasury()/owner()/prices read
// back on-chain ✓). SUPERSEDES the now-deprecated pre-guard mainnet contract
// TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha (tx 4f2bca10…, 62.71 TRX / 580,485 energy). Both networks now
// run the S-1 guarded build. Production goes live on mainnet when NEXT_PUBLIC_TRON_NETWORK=mainnet
// is set in the Vercel Production env (this file wires the address; that env var is the go-live switch).
const MAINNET: NetworkConfig = {
  network: {
    key: "mainnet",
    name: "TRON mainnet",
    fullHost: "https://api.trongrid.io",
    hostMatch: "api.trongrid",
    explorer: "https://tronscan.org",
  },
  purserPay: "TH6TVSJb7VG6fYjSGyHrHUhghJ1gg4PqXm",
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

// --- feeLimit sizing + resource pre-check constants --------------------------
// TWO-LAYER MODEL (Sprint: toolbar resource pre-check). These constants ORIENT — they drive the
// reactive dashboard "can this wallet afford the batch" line and the all-fresh feeLimit floor. The
// AUTHORITATIVE figure at pay time is a live triggerConstantContract SIMULATION of the real batch
// (src/lib/tron/disperse.ts → simulateDisperseEnergy), which sizes the actual fee_limit AND gates
// the send. Constant to orient, measurement to gate — so a stale constant can never produce a false
// "you're covered" (the dynamic-energy / upgrade risk noted at the bottom).
//
// PROVENANCE + OPEN FOLLOW-UP. These were mainnet-measured (2026-07-14) by CONSTANT-CALL SIMULATION
// (triggerConstantContract — no signature, no spend) against the NOW-DEPRECATED PRE-GUARD contract
// TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha. The S-1 guarded contract now live at
// TH6TVSJb7VG6fYjSGyHrHUhghJ1gg4PqXm adds a per-recipient Tether blacklist read (getBlackListStatus).
// N-1 MEASURED that guard delta on Nile: ~+1,100 energy/row (+3%) — a fixed staticcall+SLOAD, <1% of
// the 157,000/recipient and trivially inside the 1.5× FEE_MARGIN. So these mainnet constants are
// ACCEPTED AS SAFE-BY-MARGIN for now (owner decision — build the pre-check on them, don't block on a
// re-measure). A fresh guarded-contract re-measurement (scripts/tron/measure-mainnet.cjs against
// TH6TV… + real Tether, needing a funded measure wallet + a one-time owner approve) remains an OPEN
// FOLLOW-UP — and the pay-time simulation is the live safety net until then. See docs/06 §6 + the
// blocker atop sprint_report.txt.
//
// LINEAR FIT residual 0.0% on N=2/3/5 — the BASE + PER·N model holds exactly:
//   ENERGY_PER_RECIPIENT_FRESH    = 157,000  (marginal per FRESH recipient — never held USDT)
//   ENERGY_PER_RECIPIENT_EXISTING =  91,000  (marginal per EXISTING holder; derived from the SAME
//                                             2026-07-14 reading: existing N=3 = 275,747 energy →
//                                             (275,747−3,100)/3 ≈ 90,882, rounded up. fresh/existing
//                                             ≈ 1.72×, matching the recorded ratio)
//   ENERGY_BASE                   =   3,100  (per-tx overhead)
//
// ⚠ NILE'S MOCK/TESTNET USDT WAS NOT REPRESENTATIVE of mainnet Tether — a 3.9× MISS (Nile rehearsal
// ~36,925/recipient vs mainnet 157,000). Never calibrate energy from testnet; that is why both the
// original calibration AND the pay-time gate simulate against the LIVE mainnet contract.
//
// feeLimit is a CEILING, not a charge — the tx burns only what it uses, so over-provisioning costs
// nothing while under-provisioning kills a payroll. feeLimitForBatch sizes the all-fresh worst case
// (the floor); feeLimitFromEnergy sizes from a live measurement (the pay-time override). At
// BATCH_CAP=100 all-fresh, feeLimit ≈ 2,355 TRX (well under the 15,000 TRX protocol max).
// getAllowDynamicEnergy=1 on mainnet, so per-contract energy can rise with usage — which is exactly
// why the pay-time simulation, not the constant, has the final word.
export const ENERGY_BASE = 3_100 // MAINNET: per-tx overhead (measured 2026-07-14, pre-guard; +guard <1%)
export const ENERGY_PER_RECIPIENT_FRESH = 157_000 // MAINNET: fresh recipient (measured; Nile was 3.9× too low)
export const ENERGY_PER_RECIPIENT_EXISTING = 91_000 // MAINNET: existing USDT holder (derived; fresh/existing ≈ 1.72×)
export const ENERGY_PRICE_SUN = 100 // mainnet getEnergyFee (sun/energy) at calibration — a governance param; the pre-check reads it LIVE
export const FEE_MARGIN = 1.5 // headroom over the energy estimate
export const FEE_FLOOR_SUN = 50_000_000 // 50 TRX floor for tiny batches
export const SUN_PER_TRX = 1_000_000

// Bandwidth (tx-size) model for the resource pre-check — analytical, NOT a live measurement.
// disperse(address,address[],uint256[]) ABI-encodes to 196 + 64·N calldata bytes; add the tx
// envelope (~90 B) + signature (~66 B). Rounded up (bandwidth is a small cost — a few TRX even at
// 100 recipients — and over-provisioning is safe). Re-verify against the first real mainnet receipt.
export const BANDWIDTH_BASE_BYTES = 400 // per-tx overhead (envelope + fixed calldata), rounded up
export const BANDWIDTH_PER_RECIPIENT_BYTES = 66 // 64 B ABI (address + amount slots) + margin

/** Safe feeLimit (in sun) for a disperse of `recipientCount` recipients, sized against the
 *  all-fresh worst case with margin — the FLOOR/default. The pay-time path may raise it from a
 *  live measurement (feeLimitFromEnergy). Always well under the 15,000 TRX network max. */
export function feeLimitForBatch(recipientCount: number): number {
  const energy = ENERGY_BASE + ENERGY_PER_RECIPIENT_FRESH * recipientCount
  const sun = Math.ceil(energy * FEE_MARGIN) * ENERGY_PRICE_SUN
  return Math.max(sun, FEE_FLOOR_SUN)
}

/** feeLimit (in sun) sized from a MEASURED energy figure — a live triggerConstantContract
 *  simulation of the real batch — at the LIVE energyFee. This is the pay-time override that keeps
 *  the ceiling above the real current cost even when the static constant has drifted low (dynamic
 *  energy / upgrades). `energyFeeSun` is read live (getEnergyFee), never the hardcoded 100. */
export function feeLimitFromEnergy(energy: number, energyFeeSun: number): number {
  const sun = Math.ceil(energy * FEE_MARGIN) * Math.max(1, Math.round(energyFeeSun))
  return Math.max(sun, FEE_FLOOR_SUN)
}

/** How far back the "paid before" (✓✓) check looks in the operator's own
 *  on-chain history. */
export const HISTORY_WINDOW_DAYS = 90

/** Tronscan transaction link for a txid. */
export function txExplorerUrl(txid: string): string {
  return `${NETWORK.explorer}/#/transaction/${txid}`
}
