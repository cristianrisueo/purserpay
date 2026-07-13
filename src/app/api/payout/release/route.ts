import { NextResponse } from "next/server"

import { payerWalletHash, releaseFreeTier } from "@/lib/freeTier/quota"
import { shouldRestoreSlot } from "@/lib/freeTier/refund"
import { getTxOutcome } from "@/lib/tron/serverRead"

// POST /api/payout/release — the free-tier REFUND path.
//
// The authorize route consumes the free slot OPTIMISTICALLY, before the client
// broadcasts. If the payout then does NOT happen (the user rejected in the wallet,
// the tx reverted, or it never landed), the client calls this to restore the slot
// so a mistake never burns someone's one free payout (Law of UX #2).
//
// SERVER-SIDE VERIFICATION ONLY — never trust a client claim of failure:
//   * txid present  -> re-verify on-chain (getTxOutcome). Restore ONLY on a
//                      demonstrated "failed". "success" or "unknown" => fail
//                      closed, do NOT restore.
//   * txid === null  -> the wallet was rejected, nothing was ever broadcast, so
//                      there is nothing on-chain to verify. Restore so a rejection
//                      doesn't cost the slot. (A determined user could abuse this,
//                      but it grants nothing beyond the already-accepted direct-
//                      disperse bypass — see docs/07 "Known and accepted
//                      limitation".)
//
// Only ever relevant to free-mode payouts; a subscriber never consumed a slot.
export const runtime = "nodejs"

type ReleaseBody = {
  payerAddress?: unknown
  txid?: unknown
  consumedAt?: unknown
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 400 })
}

export async function POST(request: Request) {
  let body: ReleaseBody
  try {
    body = (await request.json()) as ReleaseBody
  } catch {
    return badRequest("Invalid JSON body.")
  }

  const payerAddress = body.payerAddress
  const consumedAt = body.consumedAt
  const txid = body.txid

  if (typeof payerAddress !== "string" || payerAddress.trim() === "") {
    return badRequest("payerAddress is required.")
  }
  // consumedAt pins the exact consume to undo; without it we can't safely restore.
  if (typeof consumedAt !== "string" || consumedAt.trim() === "") {
    return badRequest("consumedAt is required.")
  }
  if (txid != null && typeof txid !== "string") {
    return badRequest("txid must be a string or null.")
  }

  try {
    // Decide whether the payout genuinely did not happen. A broadcast tx is
    // re-verified on-chain first (never trust the client). The decision itself is
    // the pure shouldRestoreSlot helper (shared with the unit tests).
    const hasTxid = typeof txid === "string" && txid.trim() !== ""
    const outcome = hasTxid ? await getTxOutcome(txid as string) : null
    const restore = shouldRestoreSlot(hasTxid ? (txid as string) : null, outcome)

    if (restore) {
      await releaseFreeTier(payerWalletHash(payerAddress), consumedAt)
    }
    return NextResponse.json({ ok: true, restored: restore }, { status: 200 })
  } catch (e) {
    // A verification/DB error must NOT restore (fail closed) — better to keep a
    // slot consumed than to wrongly refund one whose payout may have succeeded.
    return NextResponse.json(
      {
        ok: false,
        restored: false,
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 503 }
    )
  }
}
