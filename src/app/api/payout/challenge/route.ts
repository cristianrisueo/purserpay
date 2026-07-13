import { NextResponse } from "next/server"

import { issueChallenge } from "@/lib/payout/challenge"

// GET /api/payout/challenge?address={addr} — mint a single-use wallet-control
// challenge for a payer address.
//
// The caller signs the returned `message` with its own wallet (signMessageV2) and
// hands the { nonce, signature } to /api/payout/authorize, which recovers the signer
// and asserts it equals the payer BEFORE touching any quota or credit. This proves
// wallet control without any auth system, session, or cookie — see
// docs/07-freemium-gate.md ("Proving wallet control").
//
// The address is PUBLIC on-chain, so issuing a challenge for it leaks nothing (only
// the address's holder can sign the message). Each GET mints a FRESH nonce; the
// response is never cached (cache-control: no-store).
//
// Node runtime: node:crypto (CSPRNG nonce) + the service-role Supabase client.
export const runtime = "nodejs"

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim()
  if (!address) {
    return NextResponse.json({ error: "address is required." }, { status: 400 })
  }

  try {
    const { nonce, message, expiresAt } = await issueChallenge(address)
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
