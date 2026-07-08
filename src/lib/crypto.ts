// Wallet-address pseudonymization for the compliance layer (see CLAUDE.md —
// "data dissociation"). Raw wallet addresses never touch the DB; only a salted
// SHA-256 hash does. This module is pure and portable: it reads NO env and holds
// NO secret — the caller passes the salt (WALLET_SALT, a server-only pepper), so
// this file is safe to import anywhere while the secret stays in server code.

import { createHash } from "node:crypto"

/**
 * SHA-256(`salt:address`) as a 64-char lowercase hex string.
 *
 * The salt is a secret global pepper (WALLET_SALT). Wallet addresses are
 * low-entropy — the TRON base58 space is enumerable and the OFAC SDN list is
 * public — so a plain, unsalted hash would be rainbow-table / brute-force
 * reversible. It is the SECRET salt, not the hash alone, that makes these values
 * non-reversible and non-correlatable across datasets. Keep WALLET_SALT
 * server-only; rotating it re-keys every stored hash.
 *
 * Any code that hashes the OFAC list for comparison MUST use the identical salt
 * and the same normalization (trim only) so the hashes line up.
 *
 * Uses Node's `crypto` (synchronous) to satisfy the `=> string` signature. It is
 * therefore Node-runtime only; an async Web-Crypto variant would be needed for the
 * Edge runtime (e.g. Edge middleware) and is not built here.
 *
 * A stronger keyed-hash construction would be HMAC-SHA256(key=salt, msg=address);
 * the spec calls for a salted SHA-256 hex string, which this is.
 */
export function hashWalletAddress(address: string, salt: string): string {
  const normalized = address.trim() // TRON base58 is case-sensitive — never lowercase
  if (!normalized) {
    throw new Error("hashWalletAddress: address is required")
  }
  if (!salt) {
    // Fail loud rather than silently produce an unsalted (insecure) hash — this
    // catches a missing/empty WALLET_SALT at the call site.
    throw new Error("hashWalletAddress: salt is required")
  }
  return createHash("sha256").update(`${salt}:${normalized}`).digest("hex")
}
