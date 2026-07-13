import "server-only"

// Server-only bridge to the referral schema (supabase/migrations/0003_referrals.sql).
//
// Every wallet is keyed by a SALTED SHA-256 hash — the SAME WALLET_SALT pepper +
// trim-only normalization the free tier and OFAC use (src/lib/crypto.ts). No raw
// address and no PII ever land here (data dissociation — see docs/04 + docs/08).
//
// All access is via SECURITY-INVOKER RPCs run by the service-role client, so the
// browser can never touch these tables (RLS on, no policies).

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { generateReferralCode } from "./code"

/** Read WALLET_SALT (server-only). Shared pepper across OFAC + free-tier + referrals. */
function requireWalletSalt(): string {
  const value = process.env.WALLET_SALT
  if (!value) {
    throw new Error("WALLET_SALT is not set (server-only secret; see .env.local.example).")
  }
  return value
}

/** Salted hash of a wallet — the ONLY wallet identifier the referral tables store. */
export function referralWalletHash(address: string): string {
  return hashWalletAddress(address, requireWalletSalt())
}

/**
 * Lazily upsert a wallet's referral_accounts row and return its opaque code
 * (existing on repeat calls). Retries on the rare referral_code UNIQUE collision
 * (a fresh code that already belongs to a different wallet -> 23505).
 */
export async function ensureReferralAccount(walletHash: string): Promise<string> {
  const supabase = createSupabaseServiceClient()
  const TRIES = 5
  let lastError: { code?: string; message?: string } | null = null
  for (let i = 0; i < TRIES; i++) {
    const { data, error } = await supabase.rpc("ensure_referral_account", {
      p_wallet_hash: walletHash,
      p_code: generateReferralCode(),
    })
    if (!error) return typeof data === "string" ? data : String(data)
    lastError = error
    // 23505 = unique_violation on referral_code -> a code collision; retry. Any
    // other error is not a collision, so stop.
    if (error.code !== "23505") break
  }
  throw new Error(`ensure_referral_account failed: ${lastError?.message ?? "unknown error"}`)
}

/**
 * Whether an opaque referral code exists (the /r/{code} attribution gate). A direct
 * service-role SELECT (read-only, no RPC needed); RLS denies the browser, service_role
 * bypasses it. Throws on a DB error so the caller can fail soft (redirect without a
 * cookie rather than store an unvalidated code).
 */
export async function referralCodeExists(code: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from("referral_accounts")
    .select("wallet_hash")
    .eq("referral_code", code)
    .maybeSingle()
  if (error) throw new Error(`referralCodeExists failed: ${error.message}`)
  return data != null
}

export type CreditResult = {
  /** True if the wallet is entitled via credit (just-activated OR already running). */
  entitled: boolean
  /** The credit window end (ISO) when entitled, else null. */
  activeUntil: string | null
}

/**
 * Lazily consume a banked month for a wallet — the credit half of the payout gate.
 *
 * Delegates to the atomic `consume_referral_credit` RPC. `allowActivation` MUST be
 * false when the on-chain read was unverifiable (null), so a banked month is never
 * burned on a wallet that might actually be subscribed. Throws on a DB error (the
 * caller fails closed to the free-tier path — never a wrongful denial of paid access).
 */
export async function consumeReferralCredit(
  walletHash: string,
  allowActivation: boolean
): Promise<CreditResult> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("consume_referral_credit", {
    p_wallet_hash: walletHash,
    p_allow_activation: allowActivation,
  })
  if (error) throw new Error(`consume_referral_credit failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { entitled: false, activeUntil: null }
  return {
    entitled: row.entitled === true,
    activeUntil: row.active_until != null ? String(row.active_until) : null,
  }
}

export type ClaimResult = {
  /** True only when a reward month was actually banked for the referrer. */
  granted: boolean
  /** Machine reason (granted / not_first_payment / disabled / no_referrer /
   *  unknown_code / self_referral / referrer_not_entitled / already_granted). */
  reason: string
}

/**
 * Atomically record the referee's first payment + attribution and (if all gates
 * pass) grant the referrer one banked month. Idempotent on txid and referee. See
 * `claim_referral_reward` in 0003 for the full ordered gate. The referee row must
 * already exist (call ensureReferralAccount first) and the tx must already be
 * verified on-chain (this never trusts the client's claim of a payment).
 */
export async function claimReferralReward(
  txid: string,
  refereeHash: string,
  referrerCode: string | null,
  grant: boolean
): Promise<ClaimResult> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("claim_referral_reward", {
    p_txid: txid,
    p_referee_hash: refereeHash,
    p_referrer_code: referrerCode,
    p_grant: grant,
  })
  if (error) throw new Error(`claim_referral_reward failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { granted: false, reason: "no_result" }
  return { granted: row.granted === true, reason: String(row.reason ?? "") }
}

export type ReferralSummary = {
  code: string | null
  monthsBanked: number
  creditActiveUntil: string | null
  qualifiedReferrals: number
}

/** Read a wallet's referral code, banked months, credit window, and reward count. */
export async function referralSummary(walletHash: string): Promise<ReferralSummary> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("referral_summary", {
    p_wallet_hash: walletHash,
  })
  if (error) throw new Error(`referral_summary failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return { code: null, monthsBanked: 0, creditActiveUntil: null, qualifiedReferrals: 0 }
  }
  return {
    code: row.referral_code ?? null,
    monthsBanked: Number(row.credit_balance_months ?? 0),
    creditActiveUntil: row.credit_active_until != null ? String(row.credit_active_until) : null,
    qualifiedReferrals: Number(row.qualified_referrals ?? 0),
  }
}
