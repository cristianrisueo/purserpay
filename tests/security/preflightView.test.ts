// Sprint S-3 — pure view-model for the dashboard pre-flight. These assert the owner-CLOSED visual
// doctrine as CODE: green is paid-ONLY (no security descriptor ever emits a success/paid tone),
// frozen always blocks, exchange/unverified are advisory and never block. Precedence mirrors
// previewBatch (FROZEN > UNVERIFIED > EXCHANGE). Pure/no I/O.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  rowSecurityFor,
  summarizePreflight,
  hasBlockingRow,
  toneForKind,
  type SecurityTone,
} from "../../src/lib/security/preflightView.ts"
import { lastChars } from "../../src/lib/format.ts"

// --- rowSecurityFor ---------------------------------------------------------

test("FROZEN → blocking danger descriptor (always visible, red)", () => {
  const r = rowSecurityFor({ frozen: true })
  assert.equal(r.kind, "frozen")
  assert.equal(r.blocks, true)
  assert.equal(toneForKind(r.kind), "danger")
})

test("EXCHANGE → non-blocking, carries the name; a pure exchange row is kind 'none' (no alarm badge)", () => {
  // An exchange-only row (blacklist clean, not checking) has NO blocking security kind — the
  // exchange name renders as a separate amber chip, it does not replace the validation line.
  const r = rowSecurityFor({ exchange: "Binance" })
  assert.equal(r.kind, "none")
  assert.equal(r.blocks, false)
  assert.equal(r.exchange, "Binance")
})

test("UNVERIFIED → muted, advisory, does NOT block, is NOT green (D-7)", () => {
  const r = rowSecurityFor({ unverified: true })
  assert.equal(r.kind, "unverified")
  assert.equal(r.blocks, false)
  assert.equal(toneForKind(r.kind), "muted")
})

test("checking → neutral in-flight, never assumed safe, never blocks", () => {
  const r = rowSecurityFor({ checking: true })
  assert.equal(r.kind, "checking")
  assert.equal(r.blocks, false)
})

test("READY (nothing flagged) → kind 'none', no block, no exchange", () => {
  const r = rowSecurityFor({})
  assert.equal(r.kind, "none")
  assert.equal(r.blocks, false)
  assert.equal(r.exchange, undefined)
})

test("precedence: frozen outranks checking/unverified; exchange name stays attached (orthogonal)", () => {
  const r = rowSecurityFor({ frozen: true, checking: true, unverified: true, exchange: "HTX" })
  assert.equal(r.kind, "frozen")
  assert.equal(r.blocks, true)
  assert.equal(r.exchange, "HTX")
})

test("precedence: checking outranks unverified when both set (in-flight beats a prior miss)", () => {
  const r = rowSecurityFor({ checking: true, unverified: true })
  assert.equal(r.kind, "checking")
})

// The whole point of green = paid only: NO security state may ever produce a success/paid tone.
test("GREEN-IS-PAID INVARIANT: no security kind maps to a success/paid tone", () => {
  const kinds = ["none", "checking", "frozen", "unverified"] as const
  const allowed: SecurityTone[] = ["danger", "warning", "muted"]
  for (const k of kinds) {
    const tone = toneForKind(k)
    assert.ok(allowed.includes(tone), `${k} → ${tone} must be a non-paid tone`)
    assert.notEqual(tone as string, "success")
    assert.notEqual(tone as string, "paid")
  }
})

// --- summarizePreflight (the contextual banner) -----------------------------

test("summary: counts each bucket; a clean batch says nothing (anything=false → no banner)", () => {
  const clean = summarizePreflight([{}, { exchange: undefined }, {}])
  assert.deepEqual(clean, { frozen: 0, exchange: 0, unverified: 0, anything: false })
})

test("summary: mixed batch → correct per-bucket counts, anything=true", () => {
  const s = summarizePreflight([
    { frozen: true },
    { exchange: "Gate" },
    { exchange: "Binance" },
    { unverified: true },
    {}, // ready
  ])
  assert.deepEqual(s, { frozen: 1, exchange: 2, unverified: 1, anything: true })
})

test("summary: a frozen-and-exchange row is counted ONCE (as frozen, the salient alarm)", () => {
  const s = summarizePreflight([{ frozen: true, exchange: "Binance" }])
  assert.deepEqual(s, { frozen: 1, exchange: 0, unverified: 0, anything: true })
})

test("summary: unverified outranks exchange for the bucket (mirrors previewBatch precedence)", () => {
  const s = summarizePreflight([{ unverified: true, exchange: "HTX" }])
  assert.deepEqual(s, { frozen: 0, exchange: 0, unverified: 1, anything: true })
})

// --- hasBlockingRow (Task 4: a frozen batch can never sign) -----------------

test("hasBlockingRow: any frozen row blocks the whole batch from signing", () => {
  assert.equal(hasBlockingRow([{ frozen: false }, { frozen: true }, {}]), true)
})

test("hasBlockingRow: a batch with no frozen row can sign", () => {
  assert.equal(hasBlockingRow([{}, { frozen: false }, { exchange: "Binance" }]), false)
})

// --- lastChars (Task 5: add/edit address confirmation) ----------------------

test("lastChars: returns the last 6 of a real TRON address by default", () => {
  assert.equal(lastChars("TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"), "TXc32G")
})

test("lastChars: exact tail, custom n, and short/empty safety", () => {
  assert.equal(lastChars("ABCDEFGH", 6), "CDEFGH")
  assert.equal(lastChars("ABCDEFGH", 3), "FGH")
  assert.equal(lastChars("AB", 6), "AB") // shorter than n → the whole string
  assert.equal(lastChars("", 6), "")
  assert.equal(lastChars(undefined as unknown as string, 6), "")
})
