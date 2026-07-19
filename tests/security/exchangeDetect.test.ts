// Sprint S-2 — advisory exchange-address detection. Exact, case-sensitive base58 match against
// the in-repo list. Pure/no I/O. Tests reference EXCHANGES generically so they never hard-code a
// specific real address (the list can grow without breaking them).
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  classifyAddress,
  EXCHANGES,
} from "../../src/lib/security/exchangeDetect.ts"

const seeded = EXCHANGES[0]

test("a known exchange address is flagged with its exchange name", () => {
  const r = classifyAddress(seeded.address)
  assert.equal(r.isExchange, true)
  assert.equal(r.exchange, seeded.exchange)
})

test("every seeded address classifies as its own exchange", () => {
  for (const e of EXCHANGES) {
    const r = classifyAddress(e.address)
    assert.equal(r.isExchange, true, `${e.address} should be flagged`)
    assert.equal(r.exchange, e.exchange)
  }
})

test("an unknown address is NOT flagged", () => {
  const r = classifyAddress("TUnknownPersonalWallet0000000000x")
  assert.equal(r.isExchange, false)
  assert.equal(r.exchange, undefined)
})

test("match is case-sensitive (TRON base58) — a case-variant does NOT match", () => {
  // Flip the case of one character in a seeded address; base58 is case-sensitive, so this is a
  // DIFFERENT address and must not be treated as the exchange.
  const a = seeded.address
  const i = a.length - 1
  const flipped =
    a.slice(0, i) +
    (a[i] === a[i].toLowerCase() ? a[i].toUpperCase() : a[i].toLowerCase())
  assert.notEqual(flipped, a)
  assert.equal(classifyAddress(flipped).isExchange, false)
})

test("empty / non-string input is safe and not flagged", () => {
  assert.equal(classifyAddress("").isExchange, false)
  assert.equal(classifyAddress(undefined as unknown as string).isExchange, false)
})
