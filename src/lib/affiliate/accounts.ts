import "server-only"

// Server-only bridge to the affiliate schema (supabase/migrations/0005_affiliate_portal.sql).
//
// An affiliate is a PAYEE (an OFM model / contractor) who has proven wallet control in
// the portal. Their opaque share code is REUSED from the referral schema
// (referral_accounts) — an affiliate IS a referral account, distinguished by the
// is_affiliate flag, whose reward is a MANUAL bounty (50 USDT/mo × 6 per referred
// agency) rather than a free subscription month.
//
// Every wallet is keyed by a SALTED SHA-256 hash — the SAME WALLET_SALT pepper +
// trim-only normalization used across OFAC / free-tier / referral / challenge
// (src/lib/crypto.ts). This is the shared scheme, NOT a second one. No raw address and
// NO PII ever land here (data dissociation — docs/04 + docs/09).
//
// All access is via SECURITY-INVOKER RPCs run by the service-role client (RLS on, no
// policies), so the browser can never touch these tables.

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { generateReferralCode } from "@/lib/referral/code"

/** Read WALLET_SALT (server-only). Shared pepper across OFAC + free-tier + referrals. */
function requireWalletSalt(): string {
  const value = process.env.WALLET_SALT
  if (!value) {
    throw new Error("WALLET_SALT is not set (server-only secret; see .env.local.example).")
  }
  return value
}

/** Salted hash of a wallet — the ONLY wallet identifier the affiliate tables store.
 *  Identical construction to referralWalletHash (same fn, same salt) — deliberately,
 *  so an affiliate's history keys line up with the referral/challenge layers. */
export function affiliateWalletHash(address: string): string {
  return hashWalletAddress(address, requireWalletSalt())
}

/**
 * Lazily mint/fetch the affiliate's opaque code AND mark the referral_accounts row
 * is_affiliate (via ensure_affiliate_account). Called on a VALID portal signature —
 * Ockham: no pre-population, no orphan codes for people who never show up. Retries on
 * the rare referral_code UNIQUE collision (a fresh code already owned by a different
 * wallet -> 23505), exactly like ensureReferralAccount.
 */
export async function ensureAffiliateAccount(walletHash: string): Promise<string> {
  const supabase = createSupabaseServiceClient()
  const TRIES = 5
  let lastError: { code?: string; message?: string } | null = null
  for (let i = 0; i < TRIES; i++) {
    const { data, error } = await supabase.rpc("ensure_affiliate_account", {
      p_wallet_hash: walletHash,
      p_code: generateReferralCode(),
    })
    if (!error) return typeof data === "string" ? data : String(data)
    lastError = error
    if (error.code !== "23505") break // not a code collision -> stop
  }
  throw new Error(`ensure_affiliate_account failed: ${lastError?.message ?? "unknown error"}`)
}

/**
 * GRANT-ONLY bounty write, called from the referral claim path after attribution.
 * Inserts a bounty ledger row ONLY IF `referrerCode` resolves to an affiliate-owned
 * code and it isn't a self-referral (all enforced in the RPC). Returns true when a
 * bounty was (or already had been) recorded, false otherwise. NEVER throws on a "no
 * bounty" condition and NEVER denies anything — a missing bounty must never break a
 * claim or an affiliate's receipt access.
 */
export async function recordAffiliateBounty(
  referrerCode: string | null,
  refereeHash: string
): Promise<boolean> {
  if (!referrerCode) return false
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("record_affiliate_bounty", {
    p_referrer_code: referrerCode,
    p_referee_hash: refereeHash,
  })
  if (error) throw new Error(`record_affiliate_bounty failed: ${error.message}`)
  return data === true
}

export type AffiliateBountySummary = {
  /** How many agencies this affiliate has referred (active ledger rows). */
  referredCount: number
  /** Bounty months paid out so far (owner-settled). */
  monthsPaidTotal: number
  /** Accrued (pending) USDT the owner still owes — a DEBT ACCUMULATOR, NOT a balance
   *  and NOT an on-chain amount. */
  accruedTotal: number
}

/** Read the affiliate's pending-earnings summary for the portal panel. Zero rows -> all
 *  zeros. This is display-only; it can never gate access to receipts. */
export async function affiliateBountySummary(
  walletHash: string
): Promise<AffiliateBountySummary> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("affiliate_bounty_summary", {
    p_wallet_hash: walletHash,
  })
  if (error) throw new Error(`affiliate_bounty_summary failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { referredCount: 0, monthsPaidTotal: 0, accruedTotal: 0 }
  return {
    referredCount: Number(row.referred_count ?? 0),
    monthsPaidTotal: Number(row.months_paid_total ?? 0),
    accruedTotal: Number(row.accrued_total ?? 0),
  }
}
