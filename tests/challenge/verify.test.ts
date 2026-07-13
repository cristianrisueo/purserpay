// Unit tests for the pure wallet-control VERIFICATION decision. Two layers:
//   * fakes — exercise every branch (invalid challenge, signer mismatch, error)
//     with no crypto at all.
//   * a REAL offline signMessageV2 -> verifyMessageV2 round-trip (tronweb, no
//     network) proving a genuine signer passes and a foreign signature is rejected.
// No Supabase, no network. Run with:
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { TronWeb } from "tronweb"

import { verifyWalletControl, type ChallengeVerifyDeps } from "../../src/lib/payout/challengeVerify.ts"
import { buildChallengeMessage } from "../../src/lib/payout/challengeMessage.ts"

const EXPIRES = "2026-07-13T00:05:00.000Z"
const NONCE = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// --- Layer 1: pure fakes (no crypto) ----------------------------------------

/** Identity toHex + identity hash so the pure tests read clearly; the signer the
 *  fake recoverSigner returns is what drives the branch. */
function fakeDeps(over: Partial<ChallengeVerifyDeps>): ChallengeVerifyDeps {
  return {
    hash: (a) => `hash:${a}`,
    consume: async () => ({ expiresIso: EXPIRES }),
    buildMessage: (a, n, e) => `${a}|${n}|${e}`, // content irrelevant to the fake recoverSigner
    recoverSigner: async () => "TSigner",
    toHex: (a) => a,
    ...over,
  }
}

test("ok when the recovered signer matches the address", async () => {
  const res = await verifyWalletControl(
    { address: "TSigner", nonce: NONCE, signature: "sig" },
    fakeDeps({})
  )
  assert.deepEqual(res, { ok: true })
})

test("challenge_invalid when the atomic consume returns no row", async () => {
  const res = await verifyWalletControl(
    { address: "TSigner", nonce: NONCE, signature: "sig" },
    fakeDeps({ consume: async () => null })
  )
  assert.deepEqual(res, { ok: false, reason: "challenge_invalid" })
})

test("signer_mismatch when the signature recovers a different address", async () => {
  const res = await verifyWalletControl(
    { address: "TVictim", nonce: NONCE, signature: "sig" },
    fakeDeps({ recoverSigner: async () => "TAttacker" })
  )
  assert.deepEqual(res, { ok: false, reason: "signer_mismatch" })
})

test("read_error (fail closed) when a dependency throws", async () => {
  const res = await verifyWalletControl(
    { address: "TSigner", nonce: NONCE, signature: "sig" },
    fakeDeps({
      consume: async () => {
        throw new Error("db down")
      },
    })
  )
  assert.deepEqual(res, { ok: false, reason: "read_error" })
})

test("consume is called with the salted wallet hash, not the raw address", async () => {
  let seenWalletHash: string | null = null
  await verifyWalletControl(
    { address: "TSigner", nonce: NONCE, signature: "sig" },
    fakeDeps({
      consume: async (_nonce, walletHash) => {
        seenWalletHash = walletHash
        return { expiresIso: EXPIRES }
      },
    })
  )
  assert.equal(seenWalletHash, "hash:TSigner")
})

// --- Layer 2: real offline signature round-trip (tronweb, no network) --------
// Deterministic throwaway keys (private key = 1 and 2). Never funded — used only to
// exercise ec-recover locally. new TronWeb() makes no network call on construction,
// and signMessageV2/verifyMessageV2 are pure ec-sign/ec-recover.

const tw = new TronWeb({ fullHost: "https://nile.trongrid.io" })
const PK_OWNER = "0000000000000000000000000000000000000000000000000000000000000001"
const PK_OTHER = "0000000000000000000000000000000000000000000000000000000000000002"
const OWNER = tw.address.fromPrivateKey(PK_OWNER) as string
const OTHER = tw.address.fromPrivateKey(PK_OTHER) as string

/** Real deps: the DB consume is faked (returns the fixed expiry), but the signer
 *  recovery + hex normalization are the genuine tronweb utilities the server uses. */
const realDeps: ChallengeVerifyDeps = {
  hash: (a) => `hash:${a}`,
  consume: async () => ({ expiresIso: EXPIRES }),
  buildMessage: buildChallengeMessage, // the REAL format the server + wallet agree on
  recoverSigner: (message, signature) => tw.trx.verifyMessageV2(message, signature),
  toHex: (a) => tw.address.toHex(a).replace(/^0x/, "").toLowerCase(),
}

test("real round-trip: the address holder's own signature passes", async () => {
  const message = buildChallengeMessage(OWNER, NONCE, EXPIRES)
  const signature = tw.trx.signMessageV2(message, PK_OWNER)
  const res = await verifyWalletControl(
    { address: OWNER, nonce: NONCE, signature },
    realDeps
  )
  assert.deepEqual(res, { ok: true })
})

test("real round-trip: a foreign signature over the victim's challenge is rejected", async () => {
  // The attacker obtains a challenge for OWNER (address is public) and signs it with
  // THEIR key. The message claims OWNER, but the signature recovers OTHER → mismatch.
  const message = buildChallengeMessage(OWNER, NONCE, EXPIRES)
  const foreignSignature = tw.trx.signMessageV2(message, PK_OTHER)
  const res = await verifyWalletControl(
    { address: OWNER, nonce: NONCE, signature: foreignSignature },
    realDeps
  )
  assert.deepEqual(res, { ok: false, reason: "signer_mismatch" })
  assert.notEqual(OWNER, OTHER)
})
