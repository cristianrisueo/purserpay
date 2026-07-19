import "server-only"

// Server-only wiring for the wallet-control challenge (supabase/migrations/
// 0004_payout_challenges.sql). It proves the caller controls the payer address
// before /api/payout/authorize touches any quota or credit.
//
// Every wallet is keyed by the SAME salted SHA-256 hash the OFAC / free-tier /
// referral layers use (src/lib/crypto.ts). No raw address and no PII ever land in
// the challenge table. All DB access is via SECURITY-INVOKER RPCs run by the
// service-role client (RLS on, no policies). Signer recovery is offline + keyless
// (src/lib/tron/serverRead.ts → recoverMessageSigner). Nonces come from node:crypto
// (CSPRNG) — no new dependency.

import { randomBytes } from "node:crypto"

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { addressToHexLower, recoverMessageSigner } from "@/lib/tron/serverRead"
import { buildChallengeMessage, type ChallengePurpose } from "./challengeMessage"
import { verifyWalletControl, type ChallengeVerifyResult } from "./challengeVerify"

/** How long a minted challenge is valid. Short — it exists only to bridge the one
 *  round trip between "connect" and "authorize". The DB enforces it in the atomic
 *  consume (expires_at > now()); this constant also stamps the signed message. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Read WALLET_SALT (server-only). Shared pepper across OFAC + free-tier + referrals. */
function requireWalletSalt(): string {
  const value = process.env.WALLET_SALT
  if (!value) {
    throw new Error("WALLET_SALT is not set (server-only secret; see .env.local.example).")
  }
  return value
}

/** Salted hash of a wallet — the ONLY wallet identifier the challenge table stores. */
function challengeWalletHash(address: string): string {
  return hashWalletAddress(address, requireWalletSalt())
}

export type IssuedChallenge = {
  /** The single-use nonce the client echoes back to /api/payout/authorize. */
  nonce: string
  /** The exact human-readable message the client must sign (signMessageV2). */
  message: string
  /** The challenge expiry (ISO) — informational for the client; the DB enforces it. */
  expiresAt: string
}

/**
 * Mint a fresh single-use challenge for `address`: a CSPRNG nonce, stored bound to
 * the address's salted hash with a 5-minute expiry, and the exact message to sign.
 *
 * The message embeds the same `expiresAt.toISOString()` the verify step
 * reconstructs from the stored `timestamptz`, so the signed bytes match by
 * construction. Throws on a DB error (the route surfaces a calm 503).
 *
 * `purpose` selects the message heading (payout | portal) — the SAME nonce row and
 * TTL either way (the challenge table is purpose-agnostic; the purpose lives only in
 * the signed bytes). Defaults to "payout" so the existing gate is unchanged.
 */
export async function issueChallenge(
  address: string,
  purpose: ChallengePurpose = "payout"
): Promise<IssuedChallenge> {
  const nonce = randomBytes(32).toString("hex")
  // ms-precision instant — round-trips through timestamptz and back to the same
  // canonical ISO string at verify time (the drift-guard).
  const expires = new Date(Date.now() + CHALLENGE_TTL_MS)
  const expiresAt = expires.toISOString()

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.rpc("issue_payout_challenge", {
    p_nonce: nonce,
    p_wallet_hash: challengeWalletHash(address),
    p_expires_at: expiresAt,
  })
  if (error) throw new Error(`issue_payout_challenge failed: ${error.message}`)

  return {
    nonce,
    message: buildChallengeMessage(address, nonce, expiresAt, purpose),
    expiresAt,
  }
}

/**
 * ATOMIC single-use consume of a challenge nonce — the replay + TOCTOU defense.
 *
 * Delegates to `consume_payout_challenge` (a single guarded UPDATE ... RETURNING;
 * Postgres row-locks the match). Returns the challenge's stored expiry (ISO,
 * re-normalized through `new Date().toISOString()`) when a matching UNUSED,
 * UNEXPIRED nonce for `walletHash` was consumed just now; null otherwise. Throws on
 * a DB error (verifyWalletControl catches it and fails closed).
 */
async function consumePayoutChallenge(
  nonce: string,
  walletHash: string
): Promise<{ expiresIso: string } | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("consume_payout_challenge", {
    p_nonce: nonce,
    p_wallet_hash: walletHash,
  })
  if (error) throw new Error(`consume_payout_challenge failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || row.expires_at == null) return null
  return { expiresIso: new Date(String(row.expires_at)).toISOString() }
}

/**
 * Verify the caller controls `address`: atomically consume its single-use challenge
 * and confirm the signature recovers `address`. Returns the pure
 * `verifyWalletControl` result ({ ok } | { ok:false, reason }); the route maps a
 * non-ok to 403 and NEVER reaches OFAC / subscription / quota / credit.
 *
 * `purpose` MUST match the value the challenge was ISSUED with — the reconstructed
 * message (and therefore the recovered signer) depends on it. A portal signature
 * verified against the payout purpose (or vice versa) recovers the wrong signer and
 * is rejected as signer_mismatch. Defaults to "payout".
 */
export async function verifyChallenge(
  address: string,
  nonce: string,
  signature: string,
  purpose: ChallengePurpose = "payout"
): Promise<ChallengeVerifyResult> {
  return verifyWalletControl(
    { address, nonce, signature },
    {
      hash: challengeWalletHash,
      consume: consumePayoutChallenge,
      buildMessage: (a, n, e) => buildChallengeMessage(a, n, e, purpose),
      recoverSigner: recoverMessageSigner,
      toHex: addressToHexLower,
    }
  )
}
