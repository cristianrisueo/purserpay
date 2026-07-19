import { NextResponse } from "next/server"

import { issueChallenge } from "@/lib/payout/challenge"
import type { ChallengePurpose } from "@/lib/payout/challengeMessage"

// GET /api/payout/challenge?address={addr}&purpose={payout|portal} — mint a
// single-use wallet-control challenge for a wallet address.
//
// The caller signs the returned `message` with its own wallet (signMessageV2) and
// hands the { nonce, signature } to the verifier for its purpose:
//   * purpose=payout (default) → /api/payout/authorize, which recovers the signer and
//     asserts it equals the payer BEFORE touching any quota or credit.
//   * purpose=portal            → /api/affiliate/history, which authenticates the
//     VIEWER (their signed message states it authorizes no on-chain action).
// This proves wallet control without any auth system, session, or cookie — see
// docs/07-freemium-gate.md and docs/09-affiliate-portal.md. ONE challenge primitive
// (same nonce table + atomic consume + offline recovery); only the signed message's
// heading differs, and the purpose is bound cryptographically by the signed bytes.
//
// The address is PUBLIC on-chain, so issuing a challenge for it leaks nothing (only
// the address's holder can sign the message). Each GET mints a FRESH nonce; the
// response is never cached (cache-control: no-store).
//
// Node runtime: node:crypto (CSPRNG nonce) + the service-role Supabase client.
export const runtime = "nodejs"

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const address = params.get("address")?.trim()
  if (!address) {
    return NextResponse.json({ error: "address is required." }, { status: 400 })
  }
  // Unknown/absent purpose falls back to "payout" (the existing default) — never an
  // error, so the payout flow is unaffected by a missing param.
  const purpose: ChallengePurpose = params.get("purpose") === "portal" ? "portal" : "payout"

  try {
    const { nonce, message, expiresAt } = await issueChallenge(address, purpose)
    return NextResponse.json(
      { nonce, message, expiresAt },
      { status: 200, headers: { "cache-control": "no-store" } }
    )
  } catch (e) {
    // A DB/secret failure must not silently open the gate — the client fails closed
    // (no proof → no authorize). Calm 503.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 503, headers: { "cache-control": "no-store" } }
    )
  }
}
