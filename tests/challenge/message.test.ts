// Unit tests for the pure challenge-message builder. No network, no DB, no wallet.
// The exact bytes matter: the wallet signs this string and the server recovers
// against a reconstruction of it, so the format is a contract.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import { buildChallengeMessage } from "../../src/lib/payout/challengeMessage.ts"

const ADDR = "TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC"
const NONCE = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0"
const EXPIRES = "2026-07-13T00:05:00.000Z"

test("builds the exact 4-line TIP-191 message", () => {
  assert.equal(
    buildChallengeMessage(ADDR, NONCE, EXPIRES),
    `PurserPay — authorize payout\nAddress: ${ADDR}\nNonce: ${NONCE}\nExpires: ${EXPIRES}`
  )
})

test("trims the address so issue-time and verify-time strings match", () => {
  // A stray-whitespace address must produce the identical bytes as the clean one —
  // else the signed message and the reconstruction would diverge.
  assert.equal(
    buildChallengeMessage(`  ${ADDR}  `, NONCE, EXPIRES),
    buildChallengeMessage(ADDR, NONCE, EXPIRES)
  )
})
