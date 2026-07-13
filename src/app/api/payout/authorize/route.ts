import { NextResponse } from "next/server"

import { screenRecipients } from "@/lib/compliance/ofac"
import { authorizePayout } from "@/lib/freeTier/gate"
import { consumeFreeTier, payerWalletHash } from "@/lib/freeTier/quota"
import { readSubscriptionActive } from "@/lib/tron/serverRead"

// POST /api/payout/authorize — the single authorization round trip for a payout.
//
// Combines OFAC screening, the server-side subscription read, and the free-tier
// quota into ONE decision (src/lib/freeTier/gate.ts → authorizePayout). It reads
// only what the roster tier already had to expose: the PAYER address, the
// recipient COUNT, and the recipient ADDRESSES OFAC already required. Names and
// amounts NEVER reach the server.
//
// The free slot is consumed OPTIMISTICALLY here, BEFORE the client broadcasts —
// the atomic INSERT ... ON CONFLICT ... WHERE in consume_free_tier is the whole
// TOCTOU defense. On a wallet rejection / revert the client calls
// /api/payout/release to restore the slot.
//
// Node runtime: the quota + OFAC paths use node:crypto (salted hashing) and the
// service-role Supabase client.
export const runtime = "nodejs"

type AuthorizeBody = {
  payerAddress?: unknown
  recipientCount?: unknown
  recipientAddresses?: unknown
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

  try {
    const result = await authorizePayout(
      { payerAddress, recipientAddresses: addresses },
      {
        screen: screenRecipients,
        isSubscribed: readSubscriptionActive,
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
