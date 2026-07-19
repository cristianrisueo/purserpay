// Sprint S-2 — previewBatch classifies every row for the pre-flight. Its order MIRRORS the S-1
// on-chain guard (sender frozen first, then per-row destination frozen) so preview and execution
// never disagree. Pure: blacklist statuses and the exchange classifier are injected.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  previewBatch,
  type PreviewInput,
} from "../../src/lib/security/previewBatch.ts"
import { type BlacklistStatus } from "../../src/lib/security/blacklist.ts"

const PAYER = "TPayer00000000000000000000000000p"
const FROZEN = "TFrozenDest0000000000000000000001"
const EXCH = "TExchangeDest00000000000000000002"
const UNVER = "TUnverifiedDest000000000000000003"
const BALBLOCK = "TBalanceBlocked00000000000000004"
const READY = "TReadyDest00000000000000000000005"

function status(pairs: Array<[string, BlacklistStatus]>): Map<string, BlacklistStatus> {
  return new Map(pairs)
}

// A fake exchange classifier so the test never depends on the real seeded list.
const classify = (addr: string) =>
  addr === EXCH ? { isExchange: true, exchange: "Binance" } : { isExchange: false }

function mixedInput(): PreviewInput {
  return {
    payer: PAYER,
    rows: [
      { id: "f", address: FROZEN },
      { id: "x", address: EXCH },
      { id: "u", address: UNVER },
      { id: "b", address: BALBLOCK },
      { id: "r", address: READY },
    ],
    statusByAddress: status([
      [PAYER, "SAFE"],
      [FROZEN, "FROZEN"],
      [EXCH, "SAFE"],
      // UNVER intentionally ABSENT from the map → must resolve to UNVERIFIED (D-7).
      [BALBLOCK, "SAFE"],
      [READY, "SAFE"],
    ]),
    blockedIds: new Set(["b"]),
    classify,
  }
}

function rowById(preview: ReturnType<typeof previewBatch>, id: string) {
  return preview.rows.find((r) => r.id === id)!
}

test("a mixed batch classifies each row correctly", () => {
  const p = previewBatch(mixedInput())
  assert.equal(rowById(p, "f").status, "FROZEN")
  assert.equal(rowById(p, "x").status, "EXCHANGE")
  assert.equal(rowById(p, "x").exchange, "Binance")
  assert.equal(rowById(p, "u").status, "UNVERIFIED")
  assert.equal(rowById(p, "b").status, "BLOCKED")
  assert.equal(rowById(p, "r").status, "READY")
})

test("an address absent from statusByAddress is UNVERIFIED, never READY (D-7)", () => {
  const p = previewBatch(mixedInput())
  assert.equal(rowById(p, "u").status, "UNVERIFIED")
  assert.notEqual(rowById(p, "u").status, "READY")
})

test("sender frozen surfaces at the batch level (maps to SenderBlacklisted)", () => {
  const base = mixedInput()
  const p = previewBatch({
    ...base,
    statusByAddress: new Map(base.statusByAddress).set(PAYER, "FROZEN"),
  })
  assert.equal(p.payerStatus, "FROZEN")
  assert.equal(p.senderFrozen, true)
  assert.equal(p.hasFrozen, true)
})

test("a missing payer reading → payerStatus UNVERIFIED, senderFrozen false (D-7, not a hard block)", () => {
  const base = mixedInput()
  const noPayer = new Map(base.statusByAddress)
  noPayer.delete(PAYER)
  const p = previewBatch({ ...base, statusByAddress: noPayer })
  assert.equal(p.payerStatus, "UNVERIFIED")
  assert.equal(p.senderFrozen, false)
})

test("precedence: a frozen row that is ALSO an exchange is FROZEN, with the exchange name attached", () => {
  const p = previewBatch({
    payer: PAYER,
    rows: [{ id: "fx", address: EXCH }],
    statusByAddress: status([
      [PAYER, "SAFE"],
      [EXCH, "FROZEN"],
    ]),
    classify, // EXCH is an exchange AND frozen
  })
  const row = rowById(p, "fx")
  assert.equal(row.status, "FROZEN", "FROZEN outranks EXCHANGE")
  assert.equal(row.exchange, "Binance", "exchange name still attached (orthogonal)")
})

test("precedence: FROZEN outranks a pay-time BLOCKED row (mirrors the on-chain revert order)", () => {
  const p = previewBatch({
    payer: PAYER,
    rows: [{ id: "fb", address: FROZEN }],
    statusByAddress: status([
      [PAYER, "SAFE"],
      [FROZEN, "FROZEN"],
    ]),
    blockedIds: new Set(["fb"]),
    classify,
  })
  assert.equal(rowById(p, "fb").status, "FROZEN")
})

test("precedence: UNVERIFIED outranks BLOCKED and EXCHANGE", () => {
  const p = previewBatch({
    payer: PAYER,
    rows: [{ id: "u", address: EXCH }], // exchange address, but unverified + balance-blocked
    statusByAddress: status([[PAYER, "SAFE"]]), // EXCH absent → UNVERIFIED
    blockedIds: new Set(["u"]),
    classify,
  })
  assert.equal(rowById(p, "u").status, "UNVERIFIED")
})

test("hasFrozen reflects any FROZEN row even when the sender is clean", () => {
  const p = previewBatch(mixedInput())
  assert.equal(p.senderFrozen, false)
  assert.equal(p.hasFrozen, true) // the FROZEN row 'f'
})

test("an all-ready batch has no hard block", () => {
  const p = previewBatch({
    payer: PAYER,
    rows: [{ id: "r", address: READY }],
    statusByAddress: status([
      [PAYER, "SAFE"],
      [READY, "SAFE"],
    ]),
    classify,
  })
  assert.equal(rowById(p, "r").status, "READY")
  assert.equal(p.hasFrozen, false)
  assert.equal(p.senderFrozen, false)
})
