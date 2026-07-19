// PDF SMOKE — the 1B receipt builder must produce a real, non-empty PDF and survive
// the awkward inputs it will actually see (a 64-char txid, a long payer wallet, the
// "…" truncation glyph). buildReceiptPdf takes only pre-formatted strings and imports
// no config/env, so it runs under plain `node --test`. We assert structure (a valid
// %PDF header, plausible size), not pixel content. No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import { buildReceiptPdf } from "../../src/lib/affiliate/receiptPdf.ts"

const TXID = "deadbeef".repeat(8) // 64 hex chars, the real shape
const base = {
  amountDisplay: "1,450.5",
  recipientShort: "TAbc12…wXyz",
  payerWallet: "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2",
  dateDisplayUtc: "14 Nov 2023",
  network: "nile",
  txid: TXID,
  auditId: "PP-B74B152F1CB34482",
  verifyUrl: `http://localhost:3000/verify/${TXID}?a=PP-B74B152F1CB34482`,
  explorerUrl: `https://nile.tronscan.org/#/transaction/${TXID}`,
}

test("returns a valid, non-empty PDF (%PDF header)", async () => {
  const bytes = await buildReceiptPdf(base)
  assert.ok(bytes instanceof Uint8Array)
  assert.ok(bytes.length > 1000, "PDF is non-trivial")
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-")
})

test("wraps long tokens without throwing (long payer + full txid)", async () => {
  const bytes = await buildReceiptPdf({
    ...base,
    payerWallet: "T" + "x".repeat(120),
    txid: "f".repeat(64),
  })
  assert.ok(bytes.length > 1000)
})

test("encodes the truncation glyph (…) without throwing", async () => {
  const bytes = await buildReceiptPdf({ ...base, recipientShort: "TAbcde…wxyz" })
  assert.ok(bytes.length > 1000)
})
