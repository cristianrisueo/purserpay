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

import { screenRecipients } from "@/lib/compliance/ofac"
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
 * Thin Server Action wrapper over the shared, server-only `screenRecipients`
 * core (src/lib/compliance/ofac.ts) — the SAME implementation the payout
 * authorization route uses, so the salt and normalization can never drift. Used
 * by the dashboard's roster-wide "value demo" screen (usePayout). Returns the
 * ORIGINAL addresses that are sanctioned; an empty array means clean.
 *
 * FAILS CLOSED: a missing secret or any DB error throws. The caller must treat a
 * thrown error as "cannot verify -> block the batch", never as "clean". Nothing
 * is persisted — addresses are hashed only to run the lookup (roster stays
 * device-local).
 */
export async function verifyRosterCompliance(addresses: string[]): Promise<string[]> {
  return screenRecipients(addresses)
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
