// SIGNATURE-GATE isolation (structural): the 1B PDF endpoint must prove wallet
// control BEFORE reading any receipt, and must key the lookup on the DERIVED signer
// hash — never on anything the request body could supply. Enforced by reading the
// route source, the same way tests/affiliate/grantOnly.test.ts guards the read path.
// If someone reorders the gate or lets a raw txid/wallet select a receipt, this
// fails. No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8")
const ROUTE = "../../src/app/api/affiliate/receipt/route.ts"

test("verifies a PORTAL signature BEFORE reading any receipt", () => {
  const src = read(ROUTE)
  const vc = src.indexOf("verifyChallenge(")
  const rd = src.indexOf("receiptDetail(")
  assert.ok(vc >= 0, "route calls verifyChallenge")
  assert.ok(rd >= 0, "route calls receiptDetail")
  assert.ok(vc < rd, "verifyChallenge must run before receiptDetail")
  assert.match(src, /verifyChallenge\([^)]*"portal"\)/, "challenge purpose is portal")
})

test("the lookup is keyed on the DERIVED signer hash, never a body field", () => {
  const src = read(ROUTE)
  // The hash comes from the PROVEN signer, not the request.
  assert.match(src, /affiliateWalletHash\(address\)/)
  assert.match(src, /receiptDetail\(\s*txid\.trim\(\),\s*walletHash\s*\)/)
  // No wallet/hash is ever taken from the request body as a lookup key.
  assert.doesNotMatch(src, /body\.(walletHash|recipient|hash)/i)
})

test("no receipt is served without a valid signature (fail-closed shape)", () => {
  const src = read(ROUTE)
  // A missing detail returns an error status, never a PDF; the PDF is built only
  // AFTER both the challenge passes and a row is found.
  const denied = src.indexOf("if (!proof.ok) return denied()")
  const build = src.indexOf("buildReceiptPdf(")
  assert.ok(denied >= 0 && build >= 0 && denied < build)
})
