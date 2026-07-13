import { NextResponse } from "next/server"

import { screenRecipients } from "@/lib/compliance/ofac"
import { authorizePayout } from "@/lib/freeTier/gate"
import { consumeFreeTier, payerWalletHash } from "@/lib/freeTier/quota"
import { verifyChallenge } from "@/lib/payout/challenge"
import { consumeReferralCredit, referralWalletHash } from "@/lib/referral/accounts"
import { readSubscriptionActive } from "@/lib/tron/serverRead"

// POST /api/payout/authorize — the single authorization round trip for a payout.
//
// GATE 0 (runs FIRST): PROVE WALLET CONTROL. The body carries a { nonce, signature }
// from a single-use challenge (GET /api/payout/challenge). We recover the signer and
// assert it equals payerAddress BEFORE any quota or credit is touched — a payer
// address is public on-chain, so without this anyone could consume a customer's free
// slot or burn their banked referral month. A missing/invalid proof → 403, nothing
// consumed. See docs/07-freemium-gate.md ("Proving wallet control").
//
// Then, only on a proven caller, combines OFAC screening, the server-side
// subscription read, and the free-tier quota into ONE decision (src/lib/freeTier/
// gate.ts → authorizePayout). It reads only what the roster tier already had to
// expose: the PAYER address, the recipient COUNT, and the recipient ADDRESSES OFAC
// already required. Names and amounts NEVER reach the server.
//
// The free slot is consumed OPTIMISTICALLY here, BEFORE the client broadcasts —
// the atomic INSERT ... ON CONFLICT ... WHERE in consume_free_tier is the whole
// TOCTOU defense. On a wallet rejection / revert the client calls
// /api/payout/release to restore the slot.
//
// Node runtime: the challenge, quota + OFAC paths use node:crypto (salted hashing),
// the keyless TRON client, and the service-role Supabase client.
export const runtime = "nodejs"

type AuthorizeBody = {
  payerAddress?: unknown
  recipientCount?: unknown
  recipientAddresses?: unknown
  nonce?: unknown
  signature?: unknown
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, code: "BAD_REQUEST", message }, { status: 400 })
}

export async function POST(request: Request) {
  let body: AuthorizeBody
  try {
    body = (await request.json()) as AuthorizeBody
  } catch {
    return badRequest("Invalid JSON body.")
  }

  const payerAddress = body.payerAddress
  const recipientAddresses = body.recipientAddresses
  if (typeof payerAddress !== "string" || payerAddress.trim() === "") {
    return badRequest("payerAddress is required.")
  }
  if (
    !Array.isArray(recipientAddresses) ||
    recipientAddresses.length === 0 ||
    !recipientAddresses.every((a) => typeof a === "string" && a.trim() !== "")
  ) {
    return badRequest("recipientAddresses must be a non-empty array of strings.")
  }
  // The COUNT authority is the array length, never the client's recipientCount —
  // a client can't send 5 addresses while claiming 1. (recipientCount is accepted
  // for the documented request shape but is not trusted.)
  const addresses = recipientAddresses as string[]

  const nonce = body.nonce
  const signature = body.signature
  if (
    typeof nonce !== "string" ||
    nonce.trim() === "" ||
    typeof signature !== "string" ||
    signature.trim() === ""
  ) {
    // No proof of control → refuse before touching anything.
    return NextResponse.json(
      {
        ok: false,
        code: "WALLET_PROOF_REQUIRED",
        message: "Couldn't authorize this payout — nothing was sent.",
      },
      { status: 403 }
    )
  }

  try {
    // GATE 0 — prove the caller controls payerAddress. Runs FIRST: on failure we
    // return before OFAC, the subscription read, or ANY quota/credit consume, so a
    // spoofed payer can never burn a real customer's free slot or credit month.
    const proof = await verifyChallenge(payerAddress, nonce, signature)
    if (!proof.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: "WALLET_PROOF_FAILED",
          message: "Couldn't verify wallet control — nothing was sent.",
          reason: proof.reason,
        },
        { status: 403 }
      )
    }

    const result = await authorizePayout(
      { payerAddress, recipientAddresses: addresses },
      {
        screen: screenRecipients,
        isSubscribed: readSubscriptionActive,
        // Referral credit — a subscription-equivalent, consumed by ONE atomic RPC
        // (consume_referral_credit; never a SELECT-then-UPDATE). Honored regardless
        // of REFERRALS_ENABLED (monotonic: earned access is never locked out; only
        // GRANTING new rewards is gated, in the claim route).
        checkCredit: (addr, { allowActivation }) =>
          consumeReferralCredit(referralWalletHash(addr), allowActivation),
        consumeQuota: (addr) => consumeFreeTier(payerWalletHash(addr)),
      }
    )

    if (result.ok) {
      return NextResponse.json(result, { status: 200 })
    }
    switch (result.code) {
      case "OFAC_BLOCKED":
        return NextResponse.json(result, { status: 403 })
      case "FREE_TIER_BATCH_LIMIT":
      case "FREE_TIER_COOLDOWN":
        return NextResponse.json(result, { status: 402 })
      case "SUBSCRIPTION_UNVERIFIABLE":
        return NextResponse.json(result, { status: 503 })
      default:
        return NextResponse.json(result, { status: 400 })
    }
  } catch (e) {
    // Fail closed — OFAC throw, missing secret, or a DB error. Nothing is
    // authorized; the client signs nothing.
    return NextResponse.json(
      {
        ok: false,
        code: "SCREENING_UNAVAILABLE",
        message:
          "Couldn't authorize this payout — nothing was sent. Try again in a moment.",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 }
    )
  }
}
