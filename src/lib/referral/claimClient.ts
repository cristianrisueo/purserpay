"use client"

// Client-side callers for the referral routes. The dashboard/landing never decide
// referral state themselves — the server owns it (reads the pp_ref cookie itself,
// verifies the tx on-chain, and owns the credit balance). These are thin, typed
// fetch wrappers that fail soft: a referral hiccup must NEVER block a paid user.

export type ReferralSummaryResult = {
  /** Whether the reward mechanic + card are enabled (REFERRALS_ENABLED). */
  enabled: boolean
  /** The wallet's opaque referral code (for the share link), or null if unavailable. */
  code: string | null
  /** Banked free months waiting to be consumed. */
  monthsBanked: number
  /** How many invited wallets have paid their first month (qualified referrals). */
  qualifiedReferrals: number
  /** Credit window end (ISO) if a free month is currently running, else null. */
  creditActiveUntil: string | null
}

const EMPTY_SUMMARY: ReferralSummaryResult = {
  enabled: false,
  code: null,
  monthsBanked: 0,
  qualifiedReferrals: 0,
  creditActiveUntil: null,
}

/**
 * Read the wallet's referral summary (code, banked months, credit window, reward
 * count). Drives BOTH the dashboard card and the client's freeMode parity (a
 * credit-entitled wallet must not be shown the 1-payee free UI). Returns null on
 * any transport failure so the caller can treat credit state as "unknown" and
 * simply not cap (never wrongly nag a paying customer).
 */
export async function fetchReferralSummary(
  address: string
): Promise<ReferralSummaryResult | null> {
  try {
    const res = await fetch("/api/referral/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
    const data = (await res.json().catch(() => null)) as Partial<ReferralSummaryResult> | null
    if (!res.ok || !data || typeof data !== "object") return null
    return { ...EMPTY_SUMMARY, ...data }
  } catch {
    return null
  }
}

/**
 * Report a just-confirmed on-chain subscribe so the server can (a) mark this wallet
 * a valid future referrer and (b) — if it arrived via a referral link — bank the
 * referrer a free month. Best-effort: the payment already succeeded and the gate is
 * on-chain, so a claim failure is swallowed and NEVER surfaced to the paid user. The
 * server reads the pp_ref cookie itself and re-verifies the txid on-chain; it never
 * trusts a client-supplied referrer.
 */
export async function claimReferral(refereeAddress: string, txid: string): Promise<void> {
  try {
    await fetch("/api/referral/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refereeAddress, txid }),
    })
  } catch {
    /* best-effort — a lost claim only costs one referral reward, never the sub */
  }
}
