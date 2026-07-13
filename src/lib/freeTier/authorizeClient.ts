"use client"

// Client-side callers for the payout gate route handlers. The dashboard never
// decides authorization itself — state always comes from the server (never trust
// client-side quota/subscription state). These are thin fetch wrappers that return
// a typed, discriminated result.

import type { AuthzResult } from "./gate"

/** Superset of the gate's decision plus the transport/validation error shapes the
 *  route can return. Discriminate on `ok` then `code`. */
export type AuthorizeResult =
  | AuthzResult
  | {
      ok: false
      code:
        | "BAD_REQUEST"
        | "SCREENING_UNAVAILABLE"
        | "NETWORK_ERROR"
        | "WALLET_PROOF_REQUIRED"
        | "WALLET_PROOF_FAILED"
      message?: string
    }

/**
 * POST /api/payout/authorize — one round trip: wallet-control proof + OFAC +
 * subscription + free-tier. `nonce`/`signature` come from a single-use challenge
 * (proveWalletControl); the server recovers the signer and asserts it equals
 * `payerAddress` before touching any quota/credit — a missing/invalid proof returns
 * a 403 (WALLET_PROOF_*), fail closed.
 *
 * On the free path the server consumes the slot OPTIMISTICALLY before this returns,
 * so `consumedAt` (present on `mode:"free"`) must be handed to releasePayout if the
 * broadcast then fails. Any transport failure resolves to a NETWORK_ERROR (never a
 * throw), so the caller fails closed.
 */
export async function authorizePayout(
  payerAddress: string,
  recipientAddresses: string[],
  nonce: string,
  signature: string
): Promise<AuthorizeResult> {
  try {
    const res = await fetch("/api/payout/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payerAddress,
        recipientCount: recipientAddresses.length,
        recipientAddresses,
        nonce,
        signature,
      }),
    })
    const data = (await res.json().catch(() => null)) as AuthorizeResult | null
    if (data && typeof data === "object" && "ok" in data) return data
    return { ok: false, code: "NETWORK_ERROR", message: `Unexpected response (${res.status}).` }
  } catch (e) {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * POST /api/payout/release — restore the free slot when the payout did not happen.
 * Best-effort: a lost refund only costs the user their own slot, never anyone
 * else's, so a transport failure is swallowed. The SERVER still re-verifies the
 * txid on-chain and refuses to restore a payout that actually succeeded.
 */
export async function releasePayout(
  payerAddress: string,
  txid: string | null,
  consumedAt: string
): Promise<void> {
  try {
    await fetch("/api/payout/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payerAddress, txid, consumedAt }),
    })
  } catch {
    /* best-effort refund */
  }
}
