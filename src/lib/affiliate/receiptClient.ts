"use client"

// Client-side caller for the 1B receipt PDF download. It proves wallet control with
// a PORTAL-purpose challenge (one signature — REUSES proveWalletControl, the SAME
// primitive the portal open uses) and hands { nonce, signature, txid } to
// /api/affiliate/receipt, which recovers the signer, asserts it equals the connected
// wallet, looks up THAT signer's receipt for the txid, and streams a PDF.
//
// A fresh signature authorizes each download (the challenge nonce is single-use).
// `txid` is only a selector within the signer's own data — the server never trusts it
// for authorization. Fails LOUD (calm PurserError) so the caller shows "couldn't
// build that receipt" rather than a silent no-op.

import { proveWalletControl } from "@/lib/payout/challengeClient"
import { PurserError } from "@/lib/tron/errors"
import type { WalletProviderId } from "@/lib/tron/wallet"

/**
 * Prove control of `address` (portal purpose) and download the receipt PDF for
 * `txid`. Triggers a browser download of the streamed application/pdf. Throws a calm
 * PurserError on wallet rejection, transport failure, or a non-2xx response (403 =
 * signature didn't verify; 404 = no receipt for this signer in that batch).
 */
export async function downloadReceiptPdf(
  providerId: WalletProviderId,
  address: string,
  txid: string
): Promise<void> {
  // One wallet prompt. Throws PurserError on rejection / challenge transport failure.
  const proof = await proveWalletControl(providerId, address, "portal")

  let res: Response
  try {
    res = await fetch("/api/affiliate/receipt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        nonce: proof.nonce,
        signature: proof.signature,
        txid,
      }),
    })
  } catch {
    throw new PurserError(
      "unknown",
      "Couldn't reach the server to build your receipt. Try again in a moment."
    )
  }

  if (!res.ok) {
    throw new PurserError(
      "unknown",
      "Couldn't build that receipt — nothing was downloaded. Try again in a moment."
    )
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = `purserpay-receipt-${txid.slice(0, 12)}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
