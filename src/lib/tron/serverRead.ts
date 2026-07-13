import "server-only"

import { TronWeb } from "tronweb"

import {
  NETWORK,
  PENDING_DEPLOYMENT_ADDRESS,
  PURSERPAY_ADDRESS,
} from "./config"

// Server-side, KEYLESS TRON reads for the payout authorization gate.
//
// This is the server analogue of src/lib/tron/client.ts's readClient(): a
// keyless TronWeb pointed at the public node, used ONLY for constant-calls
// (isSubscriptionActive) and receipt reads (getTransactionInfo). It NEVER signs,
// holds no key, and moves no funds — non-custodial is untouched. It exists so the
// authorization route can read the subscription and re-verify a txid WITHOUT
// trusting the client (which could lie about either).
//
// TRON_PRO_API_KEY is an OPTIONAL server-only var: unnecessary on Nile, but it
// lifts TronGrid rate limits and is recommended on mainnet. No NEXT_PUBLIC_ prefix
// — it never reaches the client.

let _server: TronWeb | null = null

/** Lazily-built keyless server read client on the configured network. */
function serverClient(): TronWeb {
  if (!_server) {
    const apiKey = process.env.TRON_PRO_API_KEY
    _server = new TronWeb({
      fullHost: NETWORK.fullHost,
      headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
    })
  }
  return _server
}

/** True once a real PurserPay address has replaced the deployment placeholder. */
function isDeployed(): boolean {
  return PURSERPAY_ADDRESS !== PENDING_DEPLOYMENT_ADDRESS
}

/**
 * Read `isSubscriptionActive(payer)` from PurserPay over the keyless server node.
 *
 * Returns:
 *   * true  — the payer has an active subscription (allow unlimited, no quota).
 *   * false — no active subscription (fall through to the free-tier quota).
 *   * null  — UNVERIFIABLE (contract not deployed, or the RPC read failed). The
 *             caller must fail closed on null: block, consume NOTHING, sign
 *             nothing — never silently burn a real subscriber's free slot.
 *
 * A constant-call: nothing is signed, no funds move, no key is used. `payer` is
 * only the constant-call `from`.
 */
export async function readSubscriptionActive(payer: string): Promise<boolean | null> {
  if (!isDeployed()) return null
  try {
    const tw = serverClient()
    const res = (await tw.transactionBuilder.triggerConstantContract(
      PURSERPAY_ADDRESS,
      "isSubscriptionActive(address)",
      {},
      [{ type: "address", value: payer }],
      payer
    )) as { result?: { result?: boolean }; constant_result?: string[] }

    if (!res?.result?.result) return null
    const hex = res.constant_result?.[0]
    if (!hex) return null
    // A bool constant_result is a 32-byte word: 0 = false, non-zero = true.
    return BigInt("0x" + hex) !== 0n
  } catch {
    return null // unverifiable -> caller fails closed
  }
}

export type TxOutcome = "success" | "failed" | "unknown"

/**
 * Re-verify a broadcast txid on-chain, server-side (the refund path never trusts a
 * client claim of failure).
 *
 * Returns:
 *   * "success" — the tx is mined and succeeded (do NOT refund the slot).
 *   * "failed"  — the tx is mined and reverted/failed (safe to refund).
 *   * "unknown" — not found / not yet mined / RPC error (fail closed: do NOT
 *                 refund; we can't prove the payout didn't happen).
 *
 * Bounded short poll so a just-mined revert is caught without hanging the request.
 */
export async function getTxOutcome(txid: string): Promise<TxOutcome> {
  if (typeof txid !== "string" || txid.trim() === "") return "unknown"
  const tw = serverClient()
  const TRIES = 3
  const DELAY_MS = 1_500
  for (let i = 0; i < TRIES; i++) {
    try {
      const info = (await tw.trx.getTransactionInfo(txid)) as {
        id?: string
        receipt?: { result?: string }
        result?: string
      }
      if (info && info.id) {
        // TRON omits receipt.result on a plain success once mined.
        const result =
          info.receipt?.result ?? (info.result === "FAILED" ? "REVERT" : "SUCCESS")
        return result === "SUCCESS" ? "success" : "failed"
      }
    } catch {
      // fall through to retry / unknown
    }
    if (i < TRIES - 1) await new Promise((r) => setTimeout(r, DELAY_MS))
  }
  return "unknown"
}
