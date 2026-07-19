import "server-only"

import { TronWeb } from "tronweb"

import {
  NETWORK,
  PENDING_DEPLOYMENT_ADDRESS,
  PURSERPAY_ADDRESS,
  USDT_ADDRESS,
} from "./config"
import { DISPERSE_SELECTOR, parseDisperseCall } from "./disperseCalldata"
import {
  readBlacklistStatuses,
  type BlacklistStatus,
} from "../security/blacklist"

// Server-side, KEYLESS TRON reads for the payout authorization gate.
//
// This is the server analogue of src/lib/tron/client.ts's readClient(): a
// keyless TronWeb pointed at the public node, used ONLY for constant-calls
// (isSubscriptionActive) and receipt reads (getTransactionInfo). It NEVER signs,
// holds no key, and moves no funds — non-custodial is untouched. It exists so the
// authorization route can read the subscription and re-verify a txid WITHOUT
// trusting the client (which could lie about either).
//
// TRON_PRO_API_KEY is a server-only var (no NEXT_PUBLIC_ prefix — it never reaches the
// client). OPTIONAL on Nile; MANDATORY on mainnet. Without it on mainnet, TronGrid
// rate-limits these reads, readSubscriptionActive() starts returning null, and the gate
// fails closed — a PAYING customer would be shown the paywall on their payday. So we fail
// LOUDLY at boot instead of silently at the worst possible moment.
if (NETWORK.key === "mainnet" && !process.env.TRON_PRO_API_KEY) {
  throw new Error(
    "TRON_PRO_API_KEY is REQUIRED on mainnet. Without it TronGrid rate-limits the " +
      "server-side subscription reads, which fails the payout gate CLOSED for paying " +
      "customers. Set TRON_PRO_API_KEY in the server environment (no NEXT_PUBLIC_ prefix)."
  )
}

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
 * Recover the base58 signer of a TIP-191 (`signMessageV2`) message — the server
 * half of the wallet-control challenge (src/lib/payout/challenge.ts). It is the
 * one place the authorize gate proves the caller controls the payer address before
 * touching any quota or credit.
 *
 * OFFLINE + KEYLESS: `verifyMessageV2` delegates to tronweb's ec-recover utility —
 * no network round trip, no key, nothing signed. `serverClient()` is reused purely
 * for its bundled util; non-custodial is untouched.
 */
export async function recoverMessageSigner(
  message: string,
  signature: string
): Promise<string> {
  return serverClient().trx.verifyMessageV2(message, signature)
}

/**
 * base58 (T…) → hex (41…), 0x-stripped and lowercased — a canonical, comparable
 * form so a recovered signer and a self-asserted address compare equal regardless
 * of base58 representation. Offline (address codec only); mirrors the `normHex`
 * normalization used in verifySubscribeTx below.
 */
export function addressToHexLower(address: string): string {
  return serverClient().address.toHex(address).replace(/^0x/, "").toLowerCase()
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

/**
 * Read USDT's `getBlackListStatus(dest)` for ONE address over the keyless server node.
 * Resolves true (frozen) / false (clean); THROWS on any failed/empty read so the caller
 * maps it to UNVERIFIED (D-7 — a failed read is NEVER treated as safe).
 *
 * Reads the SAME USDT the active-network config targets (nile/mainnet seam), independent of
 * PurserPay's deployment (USDT is deployed on both). A constant-call: nothing signed, no key,
 * no funds move — non-custodial is untouched.
 */
async function readBlacklistOnce(dest: string): Promise<boolean> {
  const tw = serverClient()
  const res = (await tw.transactionBuilder.triggerConstantContract(
    USDT_ADDRESS,
    "getBlackListStatus(address)",
    {},
    [{ type: "address", value: dest }],
    dest
  )) as { result?: { result?: boolean }; constant_result?: string[] }

  if (!res?.result?.result) throw new Error("blacklist read failed")
  const hex = res.constant_result?.[0]
  if (!hex) throw new Error("blacklist read empty")
  // A bool constant_result is a 32-byte word: 0 = false (clean), non-zero = true (frozen).
  return BigInt("0x" + hex) !== 0n
}

/**
 * The payout PRE-FLIGHT frozen-address read: classify a batch's destination addresses against
 * USDT's blacklist, FAIL-SAFE (D-7). Returns a map keyed by address with SAFE / FROZEN /
 * UNVERIFIED; a read that fails, times out, or is rate-limited is UNVERIFIED, never SAFE.
 *
 * This is ADVISORY — the on-chain guard (disperse reverts a frozen destination) is the real
 * guarantee at sign time. Dedup + bounded concurrency live in the pure `readBlacklistStatuses`;
 * this only supplies the real reader and reuses the existing TRON_PRO_API_KEY boot gate.
 */
export async function readDestinationBlacklist(
  addresses: string[]
): Promise<Map<string, BlacklistStatus>> {
  return readBlacklistStatuses(addresses, readBlacklistOnce)
}

/**
 * Result of inspecting a claimed subscribe transaction. `ok` is the gate; the
 * decoded fields (`to`/`owner` as base58, `selector` as 4-byte hex) and the machine
 * `reason` exist so the caller can LOG exactly why a claim was rejected — a silent
 * rejection is undebuggable.
 */
export type SubscribeTxCheck = {
  ok: boolean
  /** Machine reason when !ok (not_deployed / bad_txid / bad_sender / tx_failed /
   *  tx_unknown / not_trigger_contract / missing_call_fields / wrong_contract /
   *  wrong_sender / wrong_selector / read_error). */
  reason?: string
  /** The tx's target contract (base58), best-effort, for logs. */
  to?: string | null
  /** The tx's sender/owner (base58), best-effort, for logs. */
  owner?: string | null
  /** The decoded 4-byte method selector (hex, no 0x), for logs. */
  selector?: string | null
}

const SUBSCRIBE_SELECTOR = "49c7e639" // keccak256("subscribe(uint8)")[:4], no 0x

/** Normalize a TRON hex address for comparison (strip 0x, lowercase). */
function normHex(addr: string): string {
  return addr.replace(/^0x/, "").toLowerCase()
}

/** hex (41…) → base58 (T…) for logs; falls back to the hex on any error. */
function safeBase58(tw: TronWeb, hex: string): string {
  try {
    return tw.address.fromHex(hex)
  } catch {
    return hex
  }
}

/**
 * Verify a claimed subscribe transaction, server-side and untrusting (the referral
 * reward is only ever granted for a REAL on-chain payment — never a client's word).
 *
 * `ok` is true ONLY when the tx: is mined and succeeded (via getTxOutcome), is a
 * TriggerSmartContract call TO our PurserPay contract, whose method is
 * `subscribe(uint8)`, sent BY `expectedSender`. Any mismatch, undeployed contract,
 * or read failure → `{ ok:false, reason, … }` (fail closed: no verification, no
 * reward) — with the decoded `to`/`owner`/`selector` attached where available so the
 * caller can log precisely what was seen.
 *
 * Reuses the keyless `serverClient()` (no new client, no signing, no key). This is
 * the one place we read a tx's call data — `getTxOutcome` proves success but not
 * contract/method/sender, and the reward's whole anti-fraud property depends on
 * binding it to a genuine subscribe by this referee.
 */
export async function verifySubscribeTx(
  txid: string,
  expectedSender: string
): Promise<SubscribeTxCheck> {
  if (!isDeployed()) return { ok: false, reason: "not_deployed" }
  if (typeof txid !== "string" || txid.trim() === "") return { ok: false, reason: "bad_txid" }
  if (typeof expectedSender !== "string" || expectedSender.trim() === "") {
    return { ok: false, reason: "bad_sender" }
  }

  // 1) It must be mined and successful.
  const outcome = await getTxOutcome(txid)
  if (outcome !== "success") return { ok: false, reason: `tx_${outcome}` }

  // 2) It must be a subscribe(uint8) call to PurserPay by expectedSender.
  try {
    const tw = serverClient()
    const tx = (await tw.trx.getTransaction(txid)) as {
      raw_data?: {
        contract?: Array<{
          type?: string
          parameter?: {
            value?: {
              data?: string
              owner_address?: string
              contract_address?: string
            }
          }
        }>
      }
    }
    const c = tx?.raw_data?.contract?.[0]
    if (!c || c.type !== "TriggerSmartContract") {
      return { ok: false, reason: "not_trigger_contract" }
    }
    const v = c.parameter?.value
    if (!v?.data || !v.owner_address || !v.contract_address) {
      return { ok: false, reason: "missing_call_fields" }
    }

    // Decode once, for both comparison and logging.
    const selector = normHex(v.data).slice(0, 8)
    const details = {
      to: safeBase58(tw, v.contract_address),
      owner: safeBase58(tw, v.owner_address),
      selector,
    }

    const wantContract = normHex(tw.address.toHex(PURSERPAY_ADDRESS))
    const wantSender = normHex(tw.address.toHex(expectedSender))
    if (normHex(v.contract_address) !== wantContract) {
      return { ok: false, reason: "wrong_contract", ...details }
    }
    if (normHex(v.owner_address) !== wantSender) {
      return { ok: false, reason: "wrong_sender", ...details }
    }
    // The leading 4 bytes of the call data are the method selector.
    if (selector !== SUBSCRIBE_SELECTOR) {
      return { ok: false, reason: "wrong_selector", ...details }
    }

    return { ok: true, ...details }
  } catch {
    return { ok: false, reason: "read_error" } // unverifiable -> no reward
  }
}

/**
 * Result of inspecting a claimed disperse transaction. On `ok`, the decoded fields are
 * the AFFILIATE RECEIPT INDEX's source of truth (docs/09): `payer` (agency, base58),
 * `recipients` (base58) positionally paired with `amounts` (base-unit decimal strings),
 * and the block time. On `!ok`, `reason` says why for logs.
 */
export type DisperseTxCheck = {
  ok: boolean
  /** Machine reason when !ok (not_deployed / bad_txid / tx_failed / tx_unknown /
   *  not_trigger_contract / missing_call_fields / wrong_contract / wrong_selector /
   *  decode_failed / wrong_token / empty_batch / read_error). */
  reason?: string
  /** The paying agency (base58), from owner_address — public on-chain. */
  payer?: string | null
  /** Recipients (base58), decoded from the on-chain calldata (never a client claim). */
  recipients?: string[]
  /** Amounts (base-unit decimal strings), positionally paired with `recipients`. */
  amounts?: string[]
  /** Block time in ms (best-effort, from raw_data.timestamp); null if absent. */
  blockTimeMs?: number | null
  /** The decoded 4-byte selector (hex, no 0x), for logs. */
  selector?: string | null
}

/**
 * Verify a claimed disperse transaction, server-side and UNTRUSTING — the one place
 * the affiliate receipt index is populated. The client posts only a public txid; every
 * stored field is derived HERE from the tx's own on-chain calldata, so a forged or
 * unrelated txid can never inject fake receipts.
 *
 * `ok` is true ONLY when the tx: is mined and succeeded (getTxOutcome), is a
 * TriggerSmartContract call TO our PurserPay contract, whose method is
 * `disperse(address,address[],uint256[])`, whose `token` argument is USDT, with a
 * non-empty, well-formed recipients/amounts pair. Any mismatch, undecodable calldata,
 * undeployed contract, or read failure → `{ ok:false, reason, … }` (fail closed:
 * nothing recorded).
 *
 * Reuses the keyless `serverClient()` (no new client, no signing, no key). The disperse
 * path itself is permissionless and unaffected — this only READS a mined tx.
 */
export async function verifyDisperseTx(txid: string): Promise<DisperseTxCheck> {
  if (!isDeployed()) return { ok: false, reason: "not_deployed" }
  if (typeof txid !== "string" || txid.trim() === "") return { ok: false, reason: "bad_txid" }

  // 1) It must be mined and successful.
  const outcome = await getTxOutcome(txid)
  if (outcome !== "success") return { ok: false, reason: `tx_${outcome}` }

  // 2) It must be a disperse(...) call to PurserPay with the USDT token.
  try {
    const tw = serverClient()
    const tx = (await tw.trx.getTransaction(txid)) as {
      raw_data?: {
        timestamp?: number
        contract?: Array<{
          type?: string
          parameter?: {
            value?: {
              data?: string
              owner_address?: string
              contract_address?: string
            }
          }
        }>
      }
    }
    const c = tx?.raw_data?.contract?.[0]
    if (!c || c.type !== "TriggerSmartContract") {
      return { ok: false, reason: "not_trigger_contract" }
    }
    const v = c.parameter?.value
    if (!v?.data || !v.owner_address || !v.contract_address) {
      return { ok: false, reason: "missing_call_fields" }
    }

    const selector = normHex(v.data).slice(0, 8)
    if (normHex(v.contract_address) !== normHex(tw.address.toHex(PURSERPAY_ADDRESS))) {
      return { ok: false, reason: "wrong_contract", selector }
    }
    if (selector !== DISPERSE_SELECTOR) {
      return { ok: false, reason: "wrong_selector", selector }
    }

    const parsed = parseDisperseCall(v.data)
    if (!parsed) return { ok: false, reason: "decode_failed", selector }

    // The disperse `token` arg (low-20-byte hex) must be USDT. tronweb's TRON hex is
    // 41-prefixed (21 bytes); strip the 41 to compare against the 20-byte ABI form.
    const wantToken = normHex(tw.address.toHex(USDT_ADDRESS)).replace(/^41/, "")
    if (parsed.tokenHex20 !== wantToken) {
      return { ok: false, reason: "wrong_token", selector }
    }
    if (parsed.recipientsHex20.length === 0) {
      return { ok: false, reason: "empty_batch", selector }
    }

    return {
      ok: true,
      payer: safeBase58(tw, v.owner_address),
      // 41-prefix the decoded 20-byte address to reconstruct the TRON base58 form.
      recipients: parsed.recipientsHex20.map((h) => safeBase58(tw, "41" + h)),
      amounts: parsed.amounts,
      blockTimeMs: typeof tx?.raw_data?.timestamp === "number" ? tx.raw_data.timestamp : null,
      selector,
    }
  } catch {
    return { ok: false, reason: "read_error" } // unverifiable -> nothing recorded
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
