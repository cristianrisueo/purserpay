"use client"

// Client-side caller for the wallet-control challenge. Before the dashboard asks the
// server to authorize a payout, it must PROVE control of the payer wallet: fetch a
// single-use challenge, sign it with the connected wallet, and hand the { nonce,
// signature } to /api/payout/authorize. The server recovers the signer and asserts
// it equals the payer before touching any quota or credit (never trusts the client).
//
// One extra signature, no extra clicks beyond the wallet's own prompt. Fails LOUD
// (throws a calm PurserError) so the caller signs nothing on a challenge/transport
// failure or a wallet rejection — the payout gate stays fail-closed.

import { getWalletProvider, type WalletProviderId } from "@/lib/tron/wallet"
import { PurserError } from "@/lib/tron/errors"

export type WalletControlProof = { nonce: string; signature: string }

type ChallengeResponse = { nonce?: unknown; message?: unknown; expiresAt?: unknown }

/**
 * Prove the connected wallet controls `address`.
 *
 * 1) GET /api/payout/challenge?address= → { nonce, message }.
 * 2) Sign `message` with the wallet (signMessageV2 — one prompt).
 *
 * Throws a calm PurserError on a challenge/transport failure or a wallet rejection.
 * The caller catches it, shows the message, and sends nothing.
 */
export async function proveWalletControl(
  providerId: WalletProviderId,
  address: string
): Promise<WalletControlProof> {
  let data: ChallengeResponse | null
  try {
    const res = await fetch(`/api/payout/challenge?address=${encodeURIComponent(address)}`, {
      headers: { accept: "application/json" },
    })
    data = (await res.json().catch(() => null)) as ChallengeResponse | null
    if (!res.ok || typeof data?.nonce !== "string" || typeof data?.message !== "string") {
      throw new PurserError(
        "unknown",
        "Couldn't start authorization — nothing was sent. Try again in a moment."
      )
    }
  } catch (e) {
    throw e instanceof PurserError
      ? e
      : new PurserError(
          "unknown",
          "Couldn't reach the server to authorize — nothing was sent. Try again in a moment."
        )
  }

  // signMessage throws a calm userRejected() on decline — let it propagate.
  const signature = await getWalletProvider(providerId).signMessage(data.message as string)
  return { nonce: data.nonce as string, signature }
}
