"use client"

// Client-side caller for the affiliate portal read. It proves wallet control with a
// PORTAL-purpose challenge (one signature, one prompt — REUSES proveWalletControl) and
// hands the { nonce, signature } to /api/affiliate/portal, which recovers the signer,
// asserts it equals the connected wallet, and returns that wallet's OWN payload:
// disperse-anchored receipts + opaque share code + pending bounty figure.
//
// The signed message states it authenticates a VIEWER and authorizes no on-chain
// action. Fails LOUD (calm PurserError) so the portal shows "couldn't verify" rather
// than a partial/blank render — and never a leak of whether any record exists.

import { proveWalletControl } from "@/lib/payout/challengeClient"
import { PurserError } from "@/lib/tron/errors"
import type { WalletProviderId } from "@/lib/tron/wallet"

export type AffiliateReceiptRow = {
  payerWallet: string
  amountBaseUnits: string
  txid: string
  network: string
  blockTs: string | null
  recordedAt: string
}

export type AffiliateBounty = {
  referredCount: number
  monthsPaidTotal: number
  accruedTotal: number
}

export type AffiliatePortalData = {
  receipts: AffiliateReceiptRow[]
  referralCode: string
  bounty: AffiliateBounty
}

type PortalResponse = {
  ok?: unknown
  receipts?: unknown
  referralCode?: unknown
  bounty?: unknown
}

/**
 * Prove control of `address` (portal purpose) and fetch the affiliate portal payload.
 *
 * 1) proveWalletControl(providerId, address, "portal") — fetch a portal challenge and
 *    sign it (one wallet prompt). Throws a calm PurserError on rejection/transport.
 * 2) POST { address, nonce, signature } to /api/affiliate/portal. A non-2xx (403 =
 *    signature didn't verify) or an ok:false body throws so the caller shows a calm
 *    "couldn't verify your wallet" — never a partial render.
 */
export async function fetchAffiliatePortal(
  providerId: WalletProviderId,
  address: string
): Promise<AffiliatePortalData> {
  // Throws PurserError on wallet rejection / challenge transport failure.
  const proof = await proveWalletControl(providerId, address, "portal")

  let data: PortalResponse | null
  try {
    const res = await fetch("/api/affiliate/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, nonce: proof.nonce, signature: proof.signature }),
    })
    data = (await res.json().catch(() => null)) as PortalResponse | null
    if (!res.ok || !data || data.ok !== true) {
      throw new PurserError(
        "unknown",
        "Couldn't verify your wallet — nothing was shown. Try again in a moment."
      )
    }
  } catch (e) {
    throw e instanceof PurserError
      ? e
      : new PurserError(
          "unknown",
          "Couldn't reach the server to verify your wallet. Try again in a moment."
        )
  }

  const receipts = Array.isArray(data.receipts)
    ? (data.receipts as AffiliateReceiptRow[])
    : []
  const bountyRaw = (data.bounty ?? {}) as Partial<AffiliateBounty>
  return {
    receipts,
    referralCode: typeof data.referralCode === "string" ? data.referralCode : "",
    bounty: {
      referredCount: Number(bountyRaw.referredCount ?? 0),
      monthsPaidTotal: Number(bountyRaw.monthsPaidTotal ?? 0),
      accruedTotal: Number(bountyRaw.accruedTotal ?? 0),
    },
  }
}
