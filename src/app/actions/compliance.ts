"use server"

// Compliance Server Actions — OFAC screening + encrypted PII storage.
//
// These run ONLY on the server (Next.js Server Actions). They use the service-role
// Supabase client, which bypasses Row Level Security, so all compliance logic stays
// server-side and the browser never talks to Supabase for it. Secrets (WALLET_SALT,
// PII_ENCRYPTION_KEY, the service-role key) are read from server env and never reach
// the client — none carry a NEXT_PUBLIC_ prefix, and this module is server-only.
//
// See CLAUDE.md ("Data Dissociation"): the roster stays device-local; here we only
// hash recipient addresses transiently for screening (never persisted) and store the
// account holder's PII encrypted, keyed by a dissociated wallet hash.

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

/** Read a required server-only secret, failing loud with a pointer to the docs. */
function requireServerSecret(name: "WALLET_SALT" | "PII_ENCRYPTION_KEY"): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set (server-only secret; see .env.local.example).`)
  }
  return value
}

/**
 * OFAC-screen a roster of recipient addresses.
 *
 * Hashes each address server-side with WALLET_SALT (the client can't — the salt is
 * server-only) and checks the salted hashes against the ofac_sanctions table via the
 * service-role client. Returns the ORIGINAL addresses that are sanctioned; an empty
 * array means the roster is verified clean.
 *
 * FAILS CLOSED: a missing secret or any DB error throws. The caller must treat a
 * thrown error as "cannot verify -> block the batch", never as "clean". An empty
 * array is only ever returned after a successful check.
 *
 * Nothing is persisted here — the addresses are hashed only to run the lookup, in
 * keeping with the roster staying device-local.
 */
export async function verifyRosterCompliance(addresses: string[]): Promise<string[]> {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return []
  }

  const salt = requireServerSecret("WALLET_SALT")

  // hash -> original address. Keying by hash dedupes automatically and lets us map a
  // sanctioned hash back to the exact address the caller passed in.
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

/**
 * Encrypt and store an account holder's PII.
 *
 * Hashes the account's wallet address into the dissociated key, then calls the
 * pgcrypto RPC, which encrypts `piiPayload` with PII_ENCRYPTION_KEY (AES via
 * pgp_sym_encrypt) INSIDE Postgres and upserts the ciphertext. The plaintext PII
 * never lands in a column, and the encryption key is never stored in the DB.
 *
 * `piiPayload` is opaque to this layer — the caller serializes the PII (e.g. JSON of
 * name/country/tax id) into a string; we only ever handle its encrypted form at rest.
 */
export async function storeBillingProfile(address: string, piiPayload: string): Promise<void> {
  if (typeof address !== "string" || address.trim() === "") {
    throw new Error("storeBillingProfile: address is required")
  }
  if (typeof piiPayload !== "string" || piiPayload.length === 0) {
    throw new Error("storeBillingProfile: piiPayload is required")
  }

  const salt = requireServerSecret("WALLET_SALT")
  const encryptionKey = requireServerSecret("PII_ENCRYPTION_KEY")
  const walletHash = hashWalletAddress(address, salt)

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.rpc("encrypt_and_store_pii", {
    p_wallet_hash: walletHash,
    p_pii: piiPayload,
    p_key: encryptionKey,
  })

  if (error) {
    throw new Error(`storeBillingProfile failed: ${error.message}`)
  }
}
