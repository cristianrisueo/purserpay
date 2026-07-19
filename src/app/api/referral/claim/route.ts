import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { recordAffiliateBounty } from "@/lib/affiliate/accounts"
import {
  claimReferralReward,
  ensureReferralAccount,
  referralWalletHash,
} from "@/lib/referral/accounts"
import { referralsEnabled } from "@/lib/referral/config"
import { verifySubscribeTx } from "@/lib/tron/serverRead"

// POST /api/referral/claim — on a referee's confirmed on-chain subscribe: mark them
// a valid future referrer and, if they arrived via a referral link, bank the referrer
// one free month.
//
// FAIL-OPEN, BEST-EFFORT: a referral hiccup must NEVER break or roll back the
// subscription (it already succeeded on-chain). Every path returns 200
// { granted, reason }. Two untrusting guards:
//   * the referrer comes ONLY from the server-read pp_ref cookie — never the client;
//   * the payment is re-verified on-chain (verifySubscribeTx) — never the client's word.
// A month activated from CREDIT has no subscribe tx, so it can never reach a grant.
//
// OBSERVABILITY: because every rejection returns 200, a silent non-grant is
// undebuggable. So we emit ONE structured server-side log line per outcome with a
// distinct code (SUCCESS / NO_REF_COOKIE / CODE_NOT_FOUND / TX_VERIFY_FAILED /
// SELF_REFERRAL / REFEREE_ALREADY_REWARDED / REFERRER_NOT_ENTITLED / REFERRALS_DISABLED
// / …). These logs carry public on-chain data (txid, tx to/owner/selector) and the
// public share code — no PII, no secrets. Server-only (Vercel logs).
//
// Node runtime: verifySubscribeTx (keyless TRON read) + service-role Supabase.
export const runtime = "nodejs"

type Body = { refereeAddress?: unknown; txid?: unknown }

/** RPC reason (claim_referral_reward) → the log code we surface. */
const REASON_TO_CODE: Record<string, string> = {
  granted: "SUCCESS",
  not_first_payment: "REFEREE_ALREADY_REWARDED",
  already_granted: "REFEREE_ALREADY_REWARDED",
  disabled: "REFERRALS_DISABLED",
  no_referrer: "NO_REF_COOKIE",
  unknown_code: "CODE_NOT_FOUND",
  self_referral: "SELF_REFERRAL",
  referrer_not_entitled: "REFERRER_NOT_ENTITLED",
  referee_missing: "REFEREE_MISSING",
}

// Expected, high-volume outcomes log at info; anomalies worth investigating at warn.
const INFO_CODES = new Set([
  "SUCCESS",
  "NO_REF_COOKIE",
  "REFERRALS_DISABLED",
  "REFEREE_ALREADY_REWARDED",
])

/** One structured line per outcome. Public chain data + public share code only. */
function logClaim(code: string, detail: Record<string, unknown>): void {
  const line = JSON.stringify({ tag: "referral/claim", code, ...detail })
  if (INFO_CODES.has(code)) console.info(line)
  else console.warn(line)
}

function notGranted(reason: string) {
  return NextResponse.json({ granted: false, reason }, { status: 200 })
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    logClaim("BAD_REQUEST", { detail: "invalid JSON body" })
    return notGranted("bad_request")
  }

  const { refereeAddress, txid } = body
  if (typeof refereeAddress !== "string" || refereeAddress.trim() === "") {
    logClaim("BAD_REQUEST", { detail: "missing refereeAddress" })
    return notGranted("bad_request")
  }
  if (typeof txid !== "string" || txid.trim() === "") {
    logClaim("BAD_REQUEST", { detail: "missing txid", referee: refereeAddress })
    return notGranted("bad_request")
  }

  try {
    // 1) Verify the tx is a real, successful subscribe(uint8) to OUR contract BY the
    //    referee (never trust the client's claim of a payment).
    const txCheck = await verifySubscribeTx(txid, refereeAddress)
    if (!txCheck.ok) {
      logClaim("TX_VERIFY_FAILED", {
        txid,
        referee: refereeAddress,
        reason: txCheck.reason,
        to: txCheck.to ?? null,
        selector: txCheck.selector ?? null,
        owner: txCheck.owner ?? null,
      })
      return notGranted("unverifiable_tx")
    }

    // 2) Ensure the referee's own referral account (a code for a future referrer).
    const refereeHash = referralWalletHash(refereeAddress)
    await ensureReferralAccount(refereeHash)

    // 3) The server-trusted referrer comes from the HttpOnly cookie, not the client.
    const referrerCode = (await cookies()).get("pp_ref")?.value ?? null

    // 4) Atomically: mark first payment + bind attribution + (if enabled, first paid
    //    month, not self, referrer entitled) bank one month. Idempotent on txid + referee.
    const result = await claimReferralReward(
      txid,
      refereeHash,
      referrerCode,
      referralsEnabled()
    )

    logClaim(REASON_TO_CODE[result.reason] ?? "UNKNOWN", {
      txid,
      referee: refereeAddress,
      referrerCode,
      granted: result.granted,
      reason: result.reason,
    })

    // C5 — grant-only affiliate bounty ledger (docs/09). If the pp_ref referrer is an
    // AFFILIATE (a portal payee, not an agency), record an auditable ledger row for the
    // MANUAL 50-USDT/mo × 6 bounty. The RPC no-ops for non-affiliate codes, self-refs,
    // and repeats, so this NEVER double-pays an agency→agency free-month referral and
    // NEVER breaks a claim. Best-effort: swallow + log; it can only ever GRANT.
    try {
      const bountyRecorded = await recordAffiliateBounty(referrerCode, refereeHash)
      if (bountyRecorded) {
        logClaim("AFFILIATE_BOUNTY_RECORDED", { txid, referee: refereeAddress, referrerCode })
      }
    } catch (bountyErr) {
      logClaim("AFFILIATE_BOUNTY_ERROR", {
        txid,
        referee: refereeAddress,
        detail: bountyErr instanceof Error ? bountyErr.message : String(bountyErr),
      })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    // A referral error must never surface to the already-paid user.
    logClaim("ERROR", {
      txid,
      referee: refereeAddress,
      detail: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      {
        granted: false,
        reason: "error",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 200 }
    )
  }
}
