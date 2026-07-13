import "server-only"

// Opaque referral-code generator. The code is what a customer shares in their
// link (purserpay.app/r/{code}) — it is RANDOM and NEVER derived from the wallet
// address. A wallet-as-code would doxx the payout treasury to anyone holding the
// link, so the code carries zero information about the wallet behind it.
//
// Server-only: uses node:crypto for a CSPRNG. The DB enforces uniqueness
// (referral_code UNIQUE); the caller retries on the astronomically-rare collision.

import { randomBytes } from "node:crypto"

// Unambiguous, URL-safe alphabet — no 0/O, no 1/I/l. 31 symbols.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
const CODE_LENGTH = 10

/**
 * A 10-char opaque code over the unambiguous alphabet. ~31^10 ≈ 8.2e14 space, so
 * collisions are vanishingly rare (and the DB's UNIQUE + a bounded caller retry
 * make them a non-event). Uses rejection sampling so the map from random bytes to
 * symbols is unbiased (no modulo skew toward the low end of the alphabet).
 */
export function generateReferralCode(): string {
  const out: string[] = []
  // Largest multiple of ALPHABET.length that fits in a byte — bytes at/above it
  // are rejected to keep every symbol equally likely.
  const ceiling = Math.floor(256 / ALPHABET.length) * ALPHABET.length
  while (out.length < CODE_LENGTH) {
    const buf = randomBytes(CODE_LENGTH)
    for (let i = 0; i < buf.length && out.length < CODE_LENGTH; i++) {
      if (buf[i] < ceiling) out.push(ALPHABET[buf[i] % ALPHABET.length])
    }
  }
  return out.join("")
}
