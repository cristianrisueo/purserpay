// Flex Card privacy logic (Sprint 1C). The card is a PUBLIC, screenshot-able image, so
// the model that decides its text must: (1) never contain a wallet in ANY mode (D3.1),
// (2) hide the exact amount in the safe modes, (3) default to the safe mode, (4) back
// an exact amount with a verifiable /verify reference (D4.1), and (5) point the capture
// QR at the opaque /r/{code}, never a wallet. All pure — no env, no DB, no next/og.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_FLEX_MODE,
  buildFlexModel,
  figureCount,
  groupThousands,
  normalizeMode,
  rangeBucket,
  type FlexMode,
} from "../../src/lib/affiliate/flexModel.ts"

const TXID = "deadbeef".repeat(8)
const AUDIT = "PP-B74B152F1CB34482"
const CODE = "PDE4HJH9NU"
const ORIGIN = "https://purserpay.app"
// A real TRON base58 address — must NEVER appear in a model; used as a negative probe.
const WALLET = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"
const TRON_ADDR = /T[1-9A-HJ-NP-Za-km-z]{33}/ // base58 wallet shape

function model(mode: FlexMode, wholeUsdt: bigint, exactDisplay: string) {
  return buildFlexModel({
    mode,
    wholeUsdt,
    exactDisplay,
    txid: TXID,
    auditId: AUDIT,
    code: CODE,
    origin: ORIGIN,
  })
}

test("the safe default is hidden, and unknown modes coerce to it", () => {
  assert.equal(DEFAULT_FLEX_MODE, "hidden")
  assert.equal(normalizeMode(undefined), "hidden")
  assert.equal(normalizeMode("nonsense"), "hidden")
  assert.equal(normalizeMode("exact"), "exact")
  assert.equal(normalizeMode("range"), "range")
})

test("hidden hides the exact amount (digit count only)", () => {
  const m = model("hidden", 1450n, "1,450.5")
  assert.equal(m.amountPrimary, "4-figure payment")
  assert.doesNotMatch(m.amountPrimary, /1,?450/)
})

test("range shows a rounded floor, never the exact figure, and never overstates", () => {
  assert.equal(model("range", 1450n, "1,450.5").amountPrimary, "+1,000 USDT")
  assert.equal(model("range", 14505n, "14,505").amountPrimary, "+10,000 USDT")
  // Below the smallest bucket → degrades to hidden (never "+100" overstatement of a $50 pay).
  assert.equal(model("range", 50n, "50").amountPrimary, "2-figure payment")
  assert.doesNotMatch(model("range", 1450n, "1,450.5").amountPrimary, /450/)
})

test("exact shows the amount AND ties the badge to a verifiable /verify reference (D4.1)", () => {
  const m = model("exact", 1450n, "1,450.5")
  assert.equal(m.amountPrimary, "1,450.5 USDT")
  assert.equal(m.auditId, AUDIT)
  assert.equal(m.verifyRef, `${ORIGIN}/verify/${TXID}?a=${AUDIT}`)
})

test("the capture QR is ALWAYS the opaque /r/{code}, never a wallet — in every mode", () => {
  for (const mode of ["hidden", "range", "exact"] as FlexMode[]) {
    const m = model(mode, 1450n, "1,450.5")
    assert.equal(m.qrUrl, `${ORIGIN}/r/${CODE}`)
    assert.doesNotMatch(m.qrUrl, TRON_ADDR)
  }
})

test("NO wallet appears anywhere in the model, in any mode (D3.1)", () => {
  for (const mode of ["hidden", "range", "exact"] as FlexMode[]) {
    const json = JSON.stringify(model(mode, 1450n, "1,450.5"))
    assert.ok(!json.includes(WALLET), `${mode}: leaked the probe wallet`)
    assert.doesNotMatch(json, TRON_ADDR, `${mode}: model contains a wallet-shaped string`)
  }
})

test("capture copy is HONEST + English-only — qualified to the intermediary fee, never a 'free' overpromise (D3.2 / FIX-2)", () => {
  const copy = model("hidden", 1450n, "1,450.5").captureCopy
  // Qualified to the INTERMEDIARY fee (the payout carries no cut), not an absolute claim.
  assert.match(copy, /intermediary/i)
  // No "free"/"no fees ever" overpromise, and no Spanish (the product ships English-only).
  assert.doesNotMatch(copy, /\bfree\b|no fees|gratis|comisiones|intermediario|elimina/i)
})

test("rangeBucket / figureCount / groupThousands are deterministic", () => {
  assert.equal(rangeBucket(50n), null)
  assert.equal(rangeBucket(100n), 100n)
  assert.equal(rangeBucket(1450n), 1000n)
  assert.equal(rangeBucket(14505n), 10000n)
  assert.equal(rangeBucket(999999n), 500000n)
  assert.equal(rangeBucket(3_000_000n), 1000000n)

  assert.equal(figureCount(0n), 0)
  assert.equal(figureCount(9n), 1)
  assert.equal(figureCount(1450n), 4)
  assert.equal(figureCount(1_000_000n), 7)

  assert.equal(groupThousands(100n), "100")
  assert.equal(groupThousands(10000n), "10,000")
  assert.equal(groupThousands(1000000n), "1,000,000")
})
