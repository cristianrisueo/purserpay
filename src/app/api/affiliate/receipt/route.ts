import { NextResponse } from "next/server"

import { affiliateWalletHash } from "@/lib/affiliate/accounts"
import {
  formatUsdtAmount,
  formatUtcDate,
  shortWallet,
} from "@/lib/affiliate/format"
import { receiptDetail } from "@/lib/affiliate/receipts"
import { buildReceiptPdf } from "@/lib/affiliate/receiptPdf"
import { verifyChallenge } from "@/lib/payout/challenge"
import { txExplorerUrl } from "@/lib/tron/config"

// POST /api/affiliate/receipt — stream ONE receipt as a PDF "proof of source of
// funds" (Sprint 1B). Gated EXACTLY like the portal read: body { address, nonce,
// signature, txid } from a single-use PORTAL challenge
// (GET /api/payout/challenge?purpose=portal).
//
// A fresh portal signature authorizes each download (the 1A nonce is single-use;
// the owner chose fresh-sign-per-download over a session token — "don't invent a
// second gate"). verifyChallenge("portal") recovers the signer and asserts it
// equals `address`; ONLY then do we look up the receipt, keyed on hash(signer).
//
// `txid` is NOT in the signed bytes and grants NO authority — it is only a selector
// WITHIN the proven signer's OWN data. receipt_detail(txid, hash(signer)) returns a
// row ONLY if this signer was paid in that batch, so no raw-txid / raw-wallet URL can
// ever pull someone else's receipt. Every field on the PDF comes from the chain-
// derived index (verifyDisperseTx populated it), NEVER from the request body.
//
// The PDF is generated on the fly and NEVER persisted (no storage surface).
//
// Node runtime: verifyChallenge (service-role Supabase + offline recovery) + pdf-lib.
export const runtime = "nodejs"

type Body = {
  address?: unknown
  nonce?: unknown
  signature?: unknown
  txid?: unknown
}

/** Uniform 403 — never reveals WHY (bad sig vs. anything else). */
function denied() {
  return NextResponse.json({ ok: false }, { status: 403 })
}

/** Absolute origin for the verification URL, from the request (no new env var).
 *  Honors the Vercel/proxy forwarded headers; falls back to the request URL. */
function originFromRequest(request: Request): string {
  const url = new URL(request.url)
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "")
  return `${proto}://${host}`
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }

  const { address, nonce, signature, txid } = body
  if (
    typeof address !== "string" ||
    address.trim() === "" ||
    typeof nonce !== "string" ||
    nonce.trim() === "" ||
    typeof signature !== "string" ||
    signature.trim() === "" ||
    typeof txid !== "string" ||
    txid.trim() === ""
  ) {
    return denied()
  }

  try {
    // Prove the caller controls `address` (single-use portal challenge). A portal
    // signature verified here recovers `address`; anything else is signer_mismatch.
    const proof = await verifyChallenge(address, nonce, signature, "portal")
    if (!proof.ok) return denied()

    // Proven. Look up the receipt keyed on the signer's OWN salted hash + the txid.
    const walletHash = affiliateWalletHash(address)
    const detail = await receiptDetail(txid.trim(), walletHash)
    if (!detail) {
      // The signer was not paid in this batch (or it isn't indexed). Uniform 404 —
      // this only ever tells the legitimately-signed caller "not your receipt".
      return NextResponse.json({ ok: false }, { status: 404 })
    }

    const origin = originFromRequest(request)
    const verifyUrl = `${origin}/verify/${encodeURIComponent(detail.txid)}?a=${encodeURIComponent(detail.auditId)}`

    const pdf = await buildReceiptPdf({
      amountDisplay: formatUsdtAmount(detail.amountBaseUnits),
      recipientShort: shortWallet(address.trim()),
      payerWallet: detail.payerWallet,
      dateDisplayUtc: formatUtcDate(detail.blockTs, detail.recordedAt),
      network: detail.network,
      txid: detail.txid,
      auditId: detail.auditId,
      verifyUrl,
      explorerUrl: txExplorerUrl(detail.txid),
    })

    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="purserpay-receipt-${detail.auditId}.pdf"`,
        "cache-control": "no-store",
      },
    })
  } catch {
    // Fail closed — a DB/secret/render error returns nothing.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
