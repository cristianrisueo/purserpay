import { NextResponse } from "next/server"

import { recordDisperse } from "@/lib/affiliate/receipts"

// POST /api/affiliate/record — index a confirmed disperse into the receipt store,
// GOING FORWARD. Body: { txid } — ONLY the public txid; nothing else is trusted.
//
// NOT signature-gated, and it doesn't need to be: recordDisperse re-verifies the txid
// on-chain (verifyDisperseTx) and derives EVERY stored field from the tx's own
// authoritative calldata, so a caller can never inject fake receipts — at worst they
// re-record a REAL PurserPay disperse (idempotent: the unique (txid, recipient) does
// nothing on a repeat). The recipient wallets are already public in that calldata, and
// we store only their salted hashes. B5 is honored: only verified-disperse rows are
// ever written; a raw USDT transfer is rejected (wrong selector).
//
// Called fire-and-forget from usePayout's onBatchConfirmed, so it is best-effort; a
// failure never affects the payout (which already succeeded on-chain).
//
// Node runtime: verifyDisperseTx (keyless TRON read) + service-role Supabase.
export const runtime = "nodejs"

type Body = { txid?: unknown }

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 })
  }

  const { txid } = body
  if (typeof txid !== "string" || txid.trim() === "") {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 })
  }

  try {
    const result = await recordDisperse(txid.trim())
    // 200 whether or not it verified — the client is fire-and-forget and a
    // not-yet-a-disperse tx is a normal "nothing to record", not an error.
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    )
  }
}
