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
  rowLineFor,
  lineTone,
  type SecurityTone,
  type RowLine,
  type LineTone,
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

// --- rowLineFor (UX-2 — the single primary line) ----------------------------

test("rowLineFor precedence: invalid > frozen > paid-before > verifying > unverified > valid", () => {
  assert.equal(
    rowLineFor({ invalid: true, frozen: true, paidBefore: true, verifying: true, unverified: true }),
    "invalid"
  )
  assert.equal(rowLineFor({ frozen: true, paidBefore: true, verifying: true, unverified: true }), "frozen")
  assert.equal(rowLineFor({ paidBefore: true, verifying: true, unverified: true }), "paid-before")
  assert.equal(rowLineFor({ verifying: true, unverified: true }), "verifying")
  assert.equal(rowLineFor({ unverified: true }), "unverified")
  assert.equal(rowLineFor({}), "valid")
})

test("frozen outranks paid-before (a since-frozen address you paid before still shows frozen)", () => {
  assert.equal(rowLineFor({ frozen: true, paidBefore: true }), "frozen")
})

test("NO 'format-ok' limbo: a clean well-formed row resolves to 'valid', never a grey resting state", () => {
  const all: RowLine[] = [
    rowLineFor({ invalid: true }),
    rowLineFor({ frozen: true }),
    rowLineFor({ paidBefore: true }),
    rowLineFor({ verifying: true }),
    rowLineFor({ unverified: true }),
    rowLineFor({}),
  ]
  assert.equal(rowLineFor({}), "valid")
  assert.ok(!all.includes("valid-format" as RowLine))
  assert.ok(!all.includes("format-ok" as RowLine))
})

test("D-7: a verifying or unverified row is NEVER 'valid' (never assumed safe while unread/failed)", () => {
  assert.notEqual(rowLineFor({ verifying: true }), "valid")
  assert.notEqual(rowLineFor({ unverified: true }), "valid")
})

// --- lineTone (GREEN = PAID guardrail for the primary line) ------------------

test("GREEN = PAID: only 'paid-before' maps to success; 'valid' is primary (aqua), never green", () => {
  assert.equal(lineTone("paid-before"), "success")
  assert.equal(lineTone("valid"), "primary")
  assert.notEqual(lineTone("valid") as string, "success")
})

test("no non-paid line is ever green (success)", () => {
  const lines: RowLine[] = ["invalid", "frozen", "verifying", "unverified", "valid"]
  const allowed: LineTone[] = ["primary", "danger", "muted"]
  for (const l of lines) {
    const tone = lineTone(l)
    assert.notEqual(tone as string, "success", `${l} → ${tone} must not be green`)
    assert.ok(allowed.includes(tone))
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
