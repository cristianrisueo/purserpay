// The record side hashes a recipient decoded from calldata (hex -> 41-prefixed ->
// base58), the read side hashes the connected wallet's base58. They MUST produce the
// same salted hash or a payee would never see their own receipts. This proves the
// base58 round-trip is stable and the hashes line up — using the SAME salted scheme
// (src/lib/crypto.ts), never a second one. No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { TronWeb } from "tronweb"

import { hashWalletAddress } from "../../src/lib/crypto.ts"

const tw = new TronWeb({ fullHost: "https://nile.trongrid.io" })
const SALT = "affiliate-test-salt"

const ADDRS = [
  "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2",
  "TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC",
  tw.address.fromPrivateKey(
    "0000000000000000000000000000000000000000000000000000000000000001"
  ) as string,
]

test("record-side hash (hex->41->base58) equals read-side hash (connected base58)", () => {
  for (const addr of ADDRS) {
    // Record side: what verifyDisperseTx does — take the ABI 20-byte hex, 41-prefix it,
    // convert back to base58, then hash.
    const hex20 = tw.address.toHex(addr).replace(/^0x/, "").toLowerCase().slice(2)
    const rebuilt = tw.address.fromHex("41" + hex20)
    assert.equal(rebuilt, addr, "base58 round-trip must be stable")
    // Read side: hash the connected wallet's own base58. Must match.
    assert.equal(hashWalletAddress(rebuilt, SALT), hashWalletAddress(addr, SALT))
  }
})

test("hashing is salt-dependent (peppered) and case-sensitive (TRON base58 is)", () => {
  const a = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"
  assert.notEqual(hashWalletAddress(a, "salt-1"), hashWalletAddress(a, "salt-2"))
  // Changing case yields a different address entirely -> a different hash (never
  // lowercased, unlike an EVM address).
  const cased = "tESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"
  assert.notEqual(hashWalletAddress(a, SALT), hashWalletAddress(cased, SALT))
})
