// Flex Card gate isolation (Sprint 1C, structural) — the same guarantees as the 1B
// receipt route, read from the flex route source: prove wallet control BEFORE any
// receipt read; key the lookup on the DERIVED signer hash (never a body field); and
// build the card ONLY after a row is found — AND never feed a wallet into the model.
// No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8")
const ROUTE = "../../src/app/api/affiliate/flex/route.ts"

test("verifies a PORTAL signature BEFORE reading any receipt", () => {
  const src = read(ROUTE)
  const vc = src.indexOf("verifyChallenge(")
  const rd = src.indexOf("receiptDetail(")
  assert.ok(vc >= 0 && rd >= 0)
  assert.ok(vc < rd, "verifyChallenge must run before receiptDetail")
  assert.match(src, /verifyChallenge\([^)]*"portal"\)/)
})

test("the lookup is keyed on the DERIVED signer hash, never a body field", () => {
  const src = read(ROUTE)
  assert.match(src, /affiliateWalletHash\(address\)/)
  assert.match(src, /receiptDetail\(\s*txid\.trim\(\),\s*walletHash\s*\)/)
  assert.doesNotMatch(src, /body\.(walletHash|recipient|hash)/i)
})

test("the card is built only AFTER auth passes and a row is found", () => {
  const src = read(ROUTE)
  const denied = src.indexOf("if (!proof.ok) return denied()")
  const build = src.indexOf("buildFlexModel(")
  const render = src.indexOf("renderFlexCard(")
  assert.ok(denied >= 0 && build >= 0 && render >= 0)
  assert.ok(denied < build && build < render)
})

test("NO wallet is fed into the card model (the model can't leak what it never gets)", () => {
  const src = read(ROUTE)
  // Isolate the buildFlexModel({ ... }) call arguments.
  const start = src.indexOf("buildFlexModel({")
  const end = src.indexOf("})", start)
  const args = src.slice(start, end)
  assert.doesNotMatch(args, /address/, "address must not be passed to the model")
  assert.doesNotMatch(args, /payerWallet/, "the paying agency wallet must not be passed")
  assert.doesNotMatch(args, /recipient/i)
})
