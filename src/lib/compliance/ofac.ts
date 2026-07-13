import "server-only"

// OFAC recipient screening — the shared, server-only core.
//
// One implementation, two callers: the compliance Server Action
// (verifyRosterCompliance, used for the roster-wide "value demo" screen) and the
// payout authorization Route Handler (/api/payout/authorize). Keeping it here —
// not duplicated — means the screening logic, salt, and normalization can never
// drift between the two paths.
//
// Secrets (WALLET_SALT) are read from server env and never reach the client (no
// NEXT_PUBLIC_ prefix; this module is server-only). See CLAUDE.md ("Data
// Dissociation") and docs/04: addresses are hashed only to run the lookup and are
// never persisted, so the roster stays device-local.

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

/** Read a required server-only secret, failing loud with a pointer to the docs. */
function requireWalletSalt(): string {
  const value = process.env.WALLET_SALT
  if (!value) {
    throw new Error("WALLET_SALT is not set (server-only secret; see .env.local.example).")
  }
  return value
}

/**
 * OFAC-screen a list of recipient addresses.
 *
 * Hashes each address server-side with WALLET_SALT (the client can't — the salt is
 * server-only) and checks the salted hashes against the ofac_sanctions table via
 * the service-role client. Returns the ORIGINAL addresses that are sanctioned; an
 * empty array means clean.
 *
 * FAILS CLOSED: a missing secret or any DB error throws. The caller must treat a
 * thrown error as "cannot verify -> block the batch", never as "clean". An empty
 * array is only ever returned after a successful check.
 *
 * Persists nothing — the addresses are hashed only to run the lookup, keeping the
 * roster device-local.
 */
export async function screenRecipients(addresses: string[]): Promise<string[]> {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return []
  }

  const salt = requireWalletSalt()

  // hash -> original address. Keying by hash dedupes automatically and lets us map
  // a sanctioned hash back to the exact address the caller passed in.
  const hashToAddress = new Map<string, string>()
  for (const address of addresses) {
    if (typeof address !== "string" || address.trim() === "") {
      continue // skip blanks rather than hash-throwing on them
    }
    hashToAddress.set(hashWalletAddress(address, salt), address)
  }
  if (hashToAddress.size === 0) {
    return []
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from("ofac_sanctions")
    .select("wallet_hash")
    .in("wallet_hash", [...hashToAddress.keys()])

  if (error) {
    // Fail closed — an unverifiable roster must never look clean.
    throw new Error(`OFAC screening failed: ${error.message}`)
  }

  const flagged: string[] = []
  for (const row of data ?? []) {
    const original = hashToAddress.get(row.wallet_hash as string)
    if (original) {
      flagged.push(original)
    }
  }
  return flagged
}
