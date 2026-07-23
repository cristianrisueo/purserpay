// Pure, dependency-free resource pre-check math (Sprint: toolbar resource pre-check) — decides
// whether a connected wallet can afford a disperse batch (energy + bandwidth + TRX) BEFORE signing.
// No `@/`, no config import (config THROWS without NEXT_PUBLIC_TRON_NETWORK) — every input is passed
// in, so this runs directly under `node --test` (mirroring blacklist.ts / preflightView.ts). The app
// supplies the live chain params + the constant OR measured energy figure; this module does only the
// arithmetic and the verdict.
//
// CORRECTNESS ANCHOR (the misunderstanding that cost two mainnet deploys). fee_limit is the tx's
// TOTAL ENERGY CEILING — fee_limit ÷ energyFee = the max energy the tx may use — NOT a TRX-burn cap.
// Rented/staked energy makes execution cheap (fewer TRX burned) but does NOT raise that ceiling. So a
// batch is affordable only when BOTH hold:
//   (1) requiredEnergy ≤ fee_limit ÷ energyFee            (the ceiling), and
//   (2) the wallet can PAY the burn out of TRX:           max(0, requiredEnergy − energyAvailable)
//       × energyFee  +  bandwidthShortfall × txFee  ≤  trxBalance.
// Rented energy only reduces (2)'s burn; it never lifts (1). energyFee / txFee are governance params
// and are read LIVE (getEnergyFee / getTransactionFee) — never the hardcoded 100 / 1000 sun.

/** 1 TRX = 1e6 sun. A fixed denomination, never a governance parameter. */
const SUN_PER_TRX = 1_000_000

export type WalletResources = {
  /** EnergyLimit − EnergyUsed — the account's available Energy resource (staked + delegated + rented). */
  energyAvailable: number
  /** freeNetLimit − freeNetUsed — available FREE bandwidth (bytes). */
  bandwidthAvailable: number
  /** TRX balance, in sun. */
  trxSun: number
  /** Live getEnergyFee — sun per energy unit (governance param; read live, never hardcoded 100). */
  energyFeeSun: number
  /** Live getTransactionFee — sun per bandwidth byte (governance param; read live, never hardcoded 1000). */
  txFeeSun: number
}

export type EnergyConstants = {
  /** Per-tx overhead energy. */
  energyBase: number
  /** Marginal energy per FRESH recipient (never held USDT — the worst case). */
  perFresh: number
  /** Marginal energy per EXISTING USDT holder (~1.72× cheaper than fresh). */
  perExisting: number
}

export type BandwidthConstants = {
  /** Per-tx byte overhead (envelope + fixed calldata). */
  base: number
  /** Marginal bytes per recipient (ABI address + amount slots). */
  perRecipient: number
}

export type ResourceVerdict = "sufficient" | "insufficient" | "unknown"

export type ResourceAssessment = {
  verdict: ResourceVerdict
  energyRequired: number
  energyAvailable: number
  bandwidthRequired: number
  bandwidthAvailable: number
  /** Whole TRX the batch would spend on fees (energy burn + bandwidth) at current resources.
   *  ~0 when rented/staked energy fully covers it. */
  trxNeeded: number
  /** insufficient only: the energy the wallet is short — rent this much to cover it. 0 otherwise. */
  gapEnergy: number
  /** What drives an insufficient verdict, for copy. null when sufficient / unknown. */
  shortfallKind: "energy" | "bandwidth" | "ceiling" | null
}

/** Expected energy for a batch: base + per-recipient, split fresh vs existing holder. Unknown
 *  holding status is counted as FRESH by the caller (worst case) before it reaches here. */
export function estimateEnergyRequired(
  freshCount: number,
  holdingCount: number,
  c: EnergyConstants
): number {
  return (
    c.energyBase +
    c.perFresh * Math.max(0, freshCount) +
    c.perExisting * Math.max(0, holdingCount)
  )
}

/** Estimated signed-tx size (bytes) for a disperse of `recipientCount` recipients — the analytical
 *  calldata + envelope model (see config BANDWIDTH_* constants). */
export function estimateBandwidthBytes(
  recipientCount: number,
  c: BandwidthConstants
): number {
  return c.base + c.perRecipient * Math.max(0, recipientCount)
}

function ceilTrx(sun: number): number {
  return Math.ceil(Math.max(0, sun) / SUN_PER_TRX)
}

/**
 * Assess whether the wallet can afford a batch.
 *
 * `energyRequired` is the CONSTANT estimate (reactive toolbar) or the MEASURED figure (pay-time
 * gate — a live triggerConstantContract simulation). `feeLimitSun` is the fee_limit that will
 * actually be applied to the send (feeLimitForBatch for the estimate; feeLimitFromEnergy for the
 * measurement), so the ceiling check reflects the real tx.
 *
 * `resources == null` ⇒ verdict "unknown" (never block on missing data). Otherwise "sufficient"
 * iff the batch clears BOTH the fee_limit energy ceiling AND the wallet can pay any burn out of TRX;
 * else "insufficient" with the energy the wallet is short and the TRX the batch would cost.
 */
export function assessResources(input: {
  energyRequired: number
  recipientCount: number
  feeLimitSun: number
  resources: WalletResources | null
  bandwidth: BandwidthConstants
}): ResourceAssessment {
  const { energyRequired, recipientCount, feeLimitSun, resources, bandwidth } = input
  const bandwidthRequired = estimateBandwidthBytes(recipientCount, bandwidth)

  if (resources == null) {
    return {
      verdict: "unknown",
      energyRequired,
      energyAvailable: 0,
      bandwidthRequired,
      bandwidthAvailable: 0,
      trxNeeded: 0,
      gapEnergy: 0,
      shortfallKind: null,
    }
  }

  const energyAvailable = Math.max(0, resources.energyAvailable)
  const bandwidthAvailable = Math.max(0, resources.bandwidthAvailable)
  const energyFeeSun = Math.max(0, resources.energyFeeSun)
  const txFeeSun = Math.max(0, resources.txFeeSun)

  const energyShortfall = Math.max(0, energyRequired - energyAvailable)
  const bandwidthShortfall = Math.max(0, bandwidthRequired - bandwidthAvailable)
  const totalTrxNeededSun = energyShortfall * energyFeeSun + bandwidthShortfall * txFeeSun
  const trxNeeded = ceilTrx(totalTrxNeededSun)

  // (1) Ceiling: fee_limit caps TOTAL energy usable — regardless of how much energy is rented.
  const ceilingEnergy = energyFeeSun > 0 ? Math.floor(feeLimitSun / energyFeeSun) : Infinity
  const exceedsCeiling = energyRequired > ceilingEnergy
  // (2) Burn affordability: the TRX to burn any shortfall must fit in the wallet's balance.
  const canBurn = resources.trxSun >= totalTrxNeededSun

  if (!exceedsCeiling && canBurn) {
    return {
      verdict: "sufficient",
      energyRequired,
      energyAvailable,
      bandwidthRequired,
      bandwidthAvailable,
      trxNeeded,
      gapEnergy: 0,
      shortfallKind: null,
    }
  }

  const shortfallKind: "energy" | "bandwidth" | "ceiling" = exceedsCeiling
    ? "ceiling"
    : energyShortfall > 0
      ? "energy"
      : "bandwidth"

  return {
    verdict: "insufficient",
    energyRequired,
    energyAvailable,
    bandwidthRequired,
    bandwidthAvailable,
    trxNeeded,
    gapEnergy: energyShortfall,
    shortfallKind,
  }
}
