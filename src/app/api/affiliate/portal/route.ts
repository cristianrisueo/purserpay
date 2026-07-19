import { NextResponse } from "next/server"

import {
  affiliateBountySummary,
  affiliateWalletHash,
  ensureAffiliateAccount,
} from "@/lib/affiliate/accounts"
import { affiliateReceipts } from "@/lib/affiliate/receipts"
import { verifyChallenge } from "@/lib/payout/challenge"

// POST /api/affiliate/portal — the ONE signature-gated read behind the affiliate
// portal (/portal). Body: { address, nonce, signature } from a single-use PORTAL
// challenge (GET /api/payout/challenge?purpose=portal).
//
// WHY ONE ENDPOINT: the challenge nonce is single-use, and a payee should sign ONCE
// (Law of UX #1, ≤3 clicks). So this single verified call returns the whole portal:
// the payee's disperse-anchored receipts, their opaque share code, and their pending
// bounty figure — all keyed on the PROVEN signer's salted hash.
//
// AUTHENTICATES THE VIEWER, AUTHORIZES NOTHING. verifyChallenge("portal") recovers the
// signer offline and asserts it equals `address` (the signed message itself states it
// authorizes no on-chain action). Only on ok do we return data — keyed STRICTLY on
// hash(signer), never on anything in the URL (there is no code in the URL). A missing /
// invalid / replayed / expired signature → 403 with NO data and no leak of whether any
// record exists.
//
// Node runtime: verifyChallenge (service-role Supabase + keyless offline recovery) +
// the affiliate RPCs.
export const runtime = "nodejs"

type Body = { address?: unknown; nonce?: unknown; signature?: unknown }

function denied() {
  // Uniform 403 with an empty payload — never reveals WHY (bad sig vs no records) and
  // never leaks whether a wallet has any history.
  return NextResponse.json({ ok: false }, { status: 403 })
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }

  const { address, nonce, signature } = body
  if (
    typeof address !== "string" ||
    address.trim() === "" ||
    typeof nonce !== "string" ||
    nonce.trim() === "" ||
    typeof signature !== "string" ||
    signature.trim() === ""
  ) {
    return denied()
  }

  try {
    // Prove the caller controls `address`. The single-use nonce is consumed here; a
    // portal-purpose message that recovers a different signer is signer_mismatch.
    const proof = await verifyChallenge(address, nonce, signature, "portal")
    if (!proof.ok) return denied()

    // Proven. Key everything on the signer's OWN salted hash.
    const walletHash = affiliateWalletHash(address)

    // Mint/fetch the opaque code on first signature (Ockham) and mark the row an
    // affiliate. Idempotent — safe on every portal load.
    const [receipts, referralCode, bounty] = await Promise.all([
      affiliateReceipts(walletHash),
      ensureAffiliateAccount(walletHash),
      affiliateBountySummary(walletHash),
    ])

    return NextResponse.json({ ok: true, receipts, referralCode, bounty }, { status: 200 })
  } catch {
    // Fail closed — a DB/secret error returns nothing. The portal shows a calm retry.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
