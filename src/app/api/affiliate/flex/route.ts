import { NextResponse } from "next/server"

import { affiliateWalletHash, ensureAffiliateAccount } from "@/lib/affiliate/accounts"
import { renderFlexCard } from "@/lib/affiliate/flexCard"
import { formatUsdtAmount } from "@/lib/affiliate/format"
import { buildFlexModel, normalizeMode } from "@/lib/affiliate/flexModel"
import { receiptDetail } from "@/lib/affiliate/receipts"
import { verifyChallenge } from "@/lib/payout/challenge"
import { USDT_DECIMALS } from "@/lib/tron/config"

// POST /api/affiliate/flex — render ONE receipt as a 1200×630 shareable "Flex Card"
// PNG (Sprint 1C). Gated EXACTLY like the 1B PDF: body { address, nonce, signature,
// txid, mode } from a single-use PORTAL challenge. A fresh portal signature authorizes
// each card; a payee can only ever flex their OWN payment.
//
// `txid` is only a selector WITHIN the proven signer's own data (not in the signed
// bytes); receipt_detail(txid, hash(signer)) returns a row ONLY if this signer was
// paid in that batch. So no raw-txid / raw-wallet URL can produce a card for someone
// else — and, because the gate demands a signature, there is no public og:image URL
// that could leak a receipt.
//
// THE CARD CARRIES NO WALLET (D3.1): buildFlexModel is fed only the amount magnitude,
// the public txid, the Audit ID, and the opaque /r/{code} — never an address. The PNG
// is generated on the fly and NEVER stored.
//
// Node runtime: verifyChallenge (service-role Supabase + offline recovery) + next/og.
export const runtime = "nodejs"

type Body = {
  address?: unknown
  nonce?: unknown
  signature?: unknown
  txid?: unknown
  mode?: unknown
}

/** Uniform 403 — never reveals WHY. */
function denied() {
  return NextResponse.json({ ok: false }, { status: 403 })
}

/** Absolute origin from the request (no new env var); honors proxy-forwarded headers. */
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

  const { address, nonce, signature, txid, mode } = body
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
    // Prove the caller controls `address` (single-use portal challenge).
    const proof = await verifyChallenge(address, nonce, signature, "portal")
    if (!proof.ok) return denied()

    // Proven. The receipt is keyed on the signer's OWN salted hash + the txid.
    const walletHash = affiliateWalletHash(address)
    const detail = await receiptDetail(txid.trim(), walletHash)
    if (!detail) {
      // Not this signer's receipt (or not indexed). Uniform 404 — no leak.
      return NextResponse.json({ ok: false }, { status: 404 })
    }

    // The affiliate's opaque code for the capture QR (mint-on-first-sign; idempotent).
    const code = await ensureAffiliateAccount(walletHash)

    // Whole-USDT magnitude for the privacy modes; exact display for exact mode. The
    // wallet is deliberately NOT passed to the model — it can't leak what it never sees.
    const wholeUsdt = BigInt(detail.amountBaseUnits) / 10n ** BigInt(USDT_DECIMALS)
    const model = buildFlexModel({
      mode: normalizeMode(mode),
      wholeUsdt,
      exactDisplay: formatUsdtAmount(detail.amountBaseUnits),
      txid: detail.txid,
      auditId: detail.auditId,
      code,
      origin: originFromRequest(request),
    })

    return await renderFlexCard(model)
  } catch {
    // Fail closed — a DB/secret/render error returns nothing.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
