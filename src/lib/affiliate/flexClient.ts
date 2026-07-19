"use client"

// Client-side caller for the 1C Flex Card download. Mirrors receiptClient.ts (1B):
// it proves wallet control with a PORTAL-purpose challenge (one signature — REUSES
// proveWalletControl) and hands { nonce, signature, txid, mode } to
// /api/affiliate/flex, which recovers the signer, asserts it equals the connected
// wallet, and streams a 1200×630 PNG for THAT signer's receipt.
//
// A payee can only flex their OWN payment; `mode` is the mandatory privacy toggle
// (hidden | range | exact). Fails LOUD (calm PurserError).

import type { FlexMode } from "@/lib/affiliate/flexModel"
import { proveWalletControl } from "@/lib/payout/challengeClient"
import { PurserError } from "@/lib/tron/errors"
import type { WalletProviderId } from "@/lib/tron/wallet"

/**
 * Prove control of `address` (portal purpose) and download the Flex Card PNG for
 * `txid` in `mode`. Throws a calm PurserError on wallet rejection, transport failure,
 * or a non-2xx response (403 = signature didn't verify; 404 = not this signer's
 * receipt).
 */
export async function downloadFlexCard(
  providerId: WalletProviderId,
  address: string,
  txid: string,
  mode: FlexMode
): Promise<void> {
  // One wallet prompt. Throws PurserError on rejection / challenge transport failure.
  const proof = await proveWalletControl(providerId, address, "portal")

  let res: Response
  try {
    res = await fetch("/api/affiliate/flex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        nonce: proof.nonce,
        signature: proof.signature,
        txid,
        mode,
      }),
    })
  } catch {
    throw new PurserError(
      "unknown",
      "Couldn't reach the server to build your card. Try again in a moment."
    )
  }

  if (!res.ok) {
    throw new PurserError(
      "unknown",
      "Couldn't build that card — nothing was downloaded. Try again in a moment."
    )
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = `purserpay-payment-${txid.slice(0, 12)}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
