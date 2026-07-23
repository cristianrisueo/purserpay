// Sprint: toolbar resource pre-check — pure verdict math. These assert the fee_limit-is-a-total-
// energy-CEILING model as CODE (the misunderstanding that cost two mainnet deploys): a batch is
// affordable ONLY when it clears the fee_limit ceiling AND the wallet can pay any burn in TRX; rented
// energy lowers the burn but never lifts the ceiling; missing resources ⇒ "unknown", never a block.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  assessResources,
  estimateEnergyRequired,
  estimateBandwidthBytes,
  type WalletResources,
} from "../../src/lib/security/resourceCheck.ts"

// Mirror the config constants (the module is config-free by design).
const ENERGY = { energyBase: 3_100, perFresh: 157_000, perExisting: 91_000 }
const BW = { base: 400, perRecipient: 66 }
const feeLimitForBatch = (n: number): number =>
  Math.max(Math.ceil((ENERGY.energyBase + ENERGY.perFresh * n) * 1.5) * 100, 50_000_000)
const feeLimitFromEnergy = (energy: number, feeSun: number): number =>
  Math.max(Math.ceil(energy * 1.5) * Math.round(feeSun), 50_000_000)

const SUN = 1_000_000
const base = (over: Partial<WalletResources> = {}): WalletResources => ({
  energyAvailable: 0,
  bandwidthAvailable: 0,
  trxSun: 0,
  energyFeeSun: 100,
  txFeeSun: 1_000,
  ...over,
})

// --- energy / bandwidth estimates ------------------------------------------

test("estimateEnergyRequired splits fresh vs existing holder", () => {
  assert.equal(estimateEnergyRequired(3, 0, ENERGY), 3_100 + 3 * 157_000) // 474,100
  assert.equal(estimateEnergyRequired(0, 3, ENERGY), 3_100 + 3 * 91_000) // 276,100
  assert.equal(estimateEnergyRequired(2, 1, ENERGY), 3_100 + 2 * 157_000 + 91_000) // 405,100
  // Existing holders are cheaper — the whole reason to read holding status.
  assert.ok(estimateEnergyRequired(0, 3, ENERGY) < estimateEnergyRequired(3, 0, ENERGY))
})

test("estimateBandwidthBytes is base + per-recipient", () => {
  assert.equal(estimateBandwidthBytes(3, BW), 400 + 3 * 66) // 598
  assert.equal(estimateBandwidthBytes(0, BW), 400)
})

// --- assessResources --------------------------------------------------------

test("null resources ⇒ unknown (never block on missing data)", () => {
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitForBatch(3),
    resources: null,
    bandwidth: BW,
  })
  assert.equal(a.verdict, "unknown")
  assert.equal(a.gapEnergy, 0)
})

test("ample rented energy ⇒ sufficient, ~0 TRX burned", () => {
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitForBatch(3),
    resources: base({ energyAvailable: 1_000_000, bandwidthAvailable: 10_000, trxSun: 5 * SUN }),
    bandwidth: BW,
  })
  assert.equal(a.verdict, "sufficient")
  assert.equal(a.trxNeeded, 0)
  assert.equal(a.gapEnergy, 0)
})

test("no energy but enough TRX to burn ⇒ sufficient with a TRX cost", () => {
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitForBatch(3),
    resources: base({ trxSun: 100 * SUN }), // 100 TRX; burn ≈ 48 TRX
    bandwidth: BW,
  })
  assert.equal(a.verdict, "sufficient")
  // 474,100 energy × 100 sun + 598 B × 1000 sun = 48,008,000 sun → 49 TRX (ceil).
  assert.equal(a.trxNeeded, 49)
})

test("no energy and too little TRX ⇒ insufficient (energy), gap in energy units", () => {
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitForBatch(3),
    resources: base({ trxSun: 10 * SUN }), // 10 TRX << 48 TRX burn
    bandwidth: BW,
  })
  assert.equal(a.verdict, "insufficient")
  assert.equal(a.shortfallKind, "energy")
  assert.equal(a.gapEnergy, 474_100)
  assert.equal(a.trxNeeded, 49)
})

test("higher live energyFee raises the TRX burn", () => {
  const cheap = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitFromEnergy(474_100, 100),
    resources: base({ trxSun: 500 * SUN, energyFeeSun: 100 }),
    bandwidth: BW,
  })
  const dear = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitFromEnergy(474_100, 200),
    resources: base({ trxSun: 500 * SUN, energyFeeSun: 200 }),
    bandwidth: BW,
  })
  assert.equal(cheap.verdict, "sufficient")
  assert.equal(dear.verdict, "sufficient")
  assert.ok(dear.trxNeeded > cheap.trxNeeded) // same energy, pricier fee → more TRX
})

test("a risen energyFee shrinks the static fee_limit ceiling ⇒ ceiling block (toolbar case)", () => {
  // The reactive toolbar sizes fee_limit from the STATIC 100-based feeLimitForBatch. If the live
  // energyFee climbs, that fee_limit corresponds to fewer energy units and can fall below what the
  // batch needs — an OUT_OF_ENERGY the pre-check must flag even with a fat TRX balance.
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitForBatch(3), // static, 100-based
    resources: base({ trxSun: 10_000 * SUN, energyFeeSun: 200 }),
    bandwidth: BW,
  })
  assert.equal(a.verdict, "insufficient")
  assert.equal(a.shortfallKind, "ceiling")
})

test("the pay-time gate sizes fee_limit from the live fee, so the ceiling never binds", () => {
  // Same risen fee, but the authoritative gate uses feeLimitFromEnergy(measured, liveFee): the
  // ceiling scales with the fee, so only real affordability (energy/TRX) can block.
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitFromEnergy(474_100, 200),
    resources: base({ trxSun: 10_000 * SUN, energyFeeSun: 200 }),
    bandwidth: BW,
  })
  assert.equal(a.verdict, "sufficient")
})

test("bandwidth-only shortfall ⇒ insufficient (bandwidth), no energy gap", () => {
  const a = assessResources({
    energyRequired: 474_100,
    recipientCount: 3,
    feeLimitSun: feeLimitForBatch(3),
    resources: base({ energyAvailable: 1_000_000, bandwidthAvailable: 0, trxSun: 0 }),
    bandwidth: BW,
  })
  assert.equal(a.verdict, "insufficient")
  assert.equal(a.shortfallKind, "bandwidth")
  assert.equal(a.gapEnergy, 0)
})

test("zero recipients ⇒ only base energy, trivially covered", () => {
  const a = assessResources({
    energyRequired: estimateEnergyRequired(0, 0, ENERGY),
    recipientCount: 0,
    feeLimitSun: feeLimitForBatch(0),
    resources: base({ energyAvailable: 100_000, bandwidthAvailable: 10_000 }),
    bandwidth: BW,
  })
  assert.equal(a.verdict, "sufficient")
})
