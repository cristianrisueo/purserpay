// Unit tests for the PORTAL challenge purpose. Two guarantees:
//   1) The payout message stays byte-identical (the portal change is additive) and the
//      portal message is distinct + states it authorizes no on-chain action.
//   2) The purpose is bound CRYPTOGRAPHICALLY: a signature over the portal message,
//      verified against the payout purpose, recovers a different signer -> rejected. So
//      a portal signature can never be replayed as a payout approval.
// No network, no DB. Real offline ec-sign/ec-recover via tronweb.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { TronWeb } from "tronweb"

import { buildChallengeMessage } from "../../src/lib/payout/challengeMessage.ts"
import {
  verifyWalletControl,
  type ChallengeVerifyDeps,
} from "../../src/lib/payout/challengeVerify.ts"

const ADDR = "TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC"
const NONCE = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0"
const EXPIRES = "2026-07-13T00:05:00.000Z"

test("payout purpose is byte-identical to the original 4-line message (default)", () => {
  const expected = `PurserPay — authorize payout\nAddress: ${ADDR}\nNonce: ${NONCE}\nExpires: ${EXPIRES}`
  assert.equal(buildChallengeMessage(ADDR, NONCE, EXPIRES), expected)
  assert.equal(buildChallengeMessage(ADDR, NONCE, EXPIRES, "payout"), expected)
})

test("portal purpose is a DISTINCT message that disclaims on-chain action", () => {
  const portal = buildChallengeMessage(ADDR, NONCE, EXPIRES, "portal")
  const payout = buildChallengeMessage(ADDR, NONCE, EXPIRES, "payout")
  assert.notEqual(portal, payout)
  assert.match(portal, /^PurserPay — verify wallet to view receipts\n/)
  assert.match(portal, /authorizes no payment or on-chain action/)
  // Still carries the same Address/Nonce/Expires contract lines.
  assert.match(portal, new RegExp(`\\nAddress: ${ADDR}\\nNonce: ${NONCE}\\nExpires: ${EXPIRES}$`))
})

// --- Cross-purpose replay is refused (real offline round-trip) ---------------

const tw = new TronWeb({ fullHost: "https://nile.trongrid.io" })
const PK = "0000000000000000000000000000000000000000000000000000000000000001"
const SIGNER = tw.address.fromPrivateKey(PK) as string

/** Deps whose buildMessage is bound to a specific purpose — mirrors verifyChallenge. */
function depsForPurpose(purpose: "payout" | "portal"): ChallengeVerifyDeps {
  return {
    hash: (a) => `hash:${a}`,
    consume: async () => ({ expiresIso: EXPIRES }),
    buildMessage: (a, n, e) => buildChallengeMessage(a, n, e, purpose),
    recoverSigner: (message, signature) => tw.trx.verifyMessageV2(message, signature),
    toHex: (a) => tw.address.toHex(a).replace(/^0x/, "").toLowerCase(),
  }
}

test("a portal signature verifies under the portal purpose", async () => {
  const message = buildChallengeMessage(SIGNER, NONCE, EXPIRES, "portal")
  const signature = tw.trx.signMessageV2(message, PK)
  const res = await verifyWalletControl(
    { address: SIGNER, nonce: NONCE, signature },
    depsForPurpose("portal")
  )
  assert.deepEqual(res, { ok: true })
})

test("the SAME portal signature is rejected when verified as a payout (cross-purpose replay)", async () => {
  const portalMessage = buildChallengeMessage(SIGNER, NONCE, EXPIRES, "portal")
  const signature = tw.trx.signMessageV2(portalMessage, PK)
  // The payout verifier reconstructs the PAYOUT message and recovers a different signer.
  const res = await verifyWalletControl(
    { address: SIGNER, nonce: NONCE, signature },
    depsForPurpose("payout")
  )
  assert.deepEqual(res, { ok: false, reason: "signer_mismatch" })
})
