import { NextResponse } from "next/server"

import {
  ensureReferralAccount,
  referralSummary,
  referralWalletHash,
} from "@/lib/referral/accounts"
import { referralsEnabled } from "@/lib/referral/config"

// POST /api/referral/summary — the wallet's referral state for the dashboard card
// AND the client's freeMode parity (a credit-entitled wallet must not be shown the
// 1-payee free UI). Lazily upserts the referral_accounts row (generating the opaque
// code on first sight — Task 1's "lazy on first dashboard load").
//
// The credit fields are ALWAYS returned (client parity needs them even when the
// card is hidden); `enabled` gates only the card's visibility. The wallet address
// is self-asserted, exactly like the payout gate's payerAddress — the code is a
// public share token and the stats are non-sensitive, so this leaks nothing.
//
// Node runtime: uses node:crypto (salted hashing / code generation) + the
// service-role Supabase client.
export const runtime = "nodejs"

type Body = { address?: unknown }

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const address = body.address
  if (typeof address !== "string" || address.trim() === "") {
    return NextResponse.json({ error: "address is required." }, { status: 400 })
  }

  try {
    const hash = referralWalletHash(address)
    // Lazily create the account (and its code) on first sight, then read it back.
    await ensureReferralAccount(hash)
    const summary = await referralSummary(hash)
    return NextResponse.json({
      enabled: referralsEnabled(),
      code: summary.code,
      monthsBanked: summary.monthsBanked,
      qualifiedReferrals: summary.qualifiedReferrals,
      creditActiveUntil: summary.creditActiveUntil,
    })
  } catch (e) {
    // Never hard-fail the dashboard on a referral read; the client treats a failure
    // as "unknown" and simply doesn't render the card or cap the UI.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    )
  }
}
