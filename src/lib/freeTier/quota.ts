import "server-only"

// Free-tier quota adapter — the server-only bridge to the free_tier_usage table.
//
// The quota is anchored on the PAYER wallet hash ONLY (salted SHA-256, same
// WALLET_SALT pepper + trim-only normalization as OFAC — src/lib/crypto.ts). The
// raw address never lands in the DB. Recipients are NEVER used for the quota.
//
// All access is via SECURITY-INVOKER RPCs run by the service-role client, so the
// browser can never touch the table (RLS on, no policies). See
// supabase/migrations/0002_free_tier_usage.sql and docs/07-freemium-gate.md.

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

/** Read WALLET_SALT (server-only). Shared pepper across OFAC + the quota. */
function requireWalletSalt(): string {
  const value = process.env.WALLET_SALT
  if (!value) {
    throw new Error("WALLET_SALT is not set (server-only secret; see .env.local.example).")
  }
  return value
}

/** Salted hash of a payer wallet — the ONLY thing the quota table ever stores. */
export function payerWalletHash(payerAddress: string): string {
  return hashWalletAddress(payerAddress, requireWalletSalt())
}

export type ConsumeResult = {
  /** true if the slot was consumed just now; false if still in cooldown. */
  consumed: boolean
  /** On success: the moment consumed (now). On block: the existing
   *  last_free_payout_at, so the caller can compute nextAvailableAt = at + 30d. */
  at: string | null
}

/**
 * ATOMICALLY consume the free slot for a payer wallet — the whole TOCTOU defense.
 *
 * Delegates to the `consume_free_tier` RPC (a single INSERT ... ON CONFLICT ...
 * WHERE ... RETURNING; Postgres row-locks the conflict target). Call this
 * OPTIMISTICALLY, BEFORE the client broadcasts. Throws on a DB error (the caller
 * fails closed).
 */
export async function consumeFreeTier(walletHash: string): Promise<ConsumeResult> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("consume_free_tier", {
    p_wallet_hash: walletHash,
  })
  if (error) {
    throw new Error(`consume_free_tier failed: ${error.message}`)
  }
  // The RPC returns a single-row table (consumed, at).
  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    // No row at all is unexpected (a successful consume always returns one); treat
    // as "could not consume" so the caller never signs on an ambiguous result.
    return { consumed: false, at: null }
  }
  return {
    consumed: row.consumed === true,
    at: row.at != null ? String(row.at) : null,
  }
}

/**
 * Restore a slot the payout never actually used (verified server-side only).
 *
 * Delegates to `release_free_tier`, which deletes ONLY the exact consume identified
 * by (walletHash, consumedAt) — so a newer consume is never wiped. Idempotent: a
 * mismatch is a harmless no-op.
 */
export async function releaseFreeTier(
  walletHash: string,
  consumedAt: string
): Promise<void> {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.rpc("release_free_tier", {
    p_wallet_hash: walletHash,
    p_consumed_at: consumedAt,
  })
  if (error) {
    throw new Error(`release_free_tier failed: ${error.message}`)
  }
}
