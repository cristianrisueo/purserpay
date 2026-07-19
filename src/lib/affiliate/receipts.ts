import "server-only"

// Server-only bridge to the disperse-anchored receipt index
// (supabase/migrations/0005_affiliate_portal.sql → disperse_receipts).
//
// THE ONE RULE (B5, docs/09): a receipt exists ONLY if it passed through PurserPay's
// disperse contract, sourced from OUR records — NEVER a generic "USDT transfers to this
// address" chain scan. So:
//   * RECORD trusts only a public txid; verifyDisperseTx decodes the tx's OWN on-chain
//     calldata (forgery-proof) and we store the hashed recipients + amounts + payer.
//     Chain = the verification/source; the index = where we READ it back. No one should
//     ever "read receipts from the chain" at display time.
//   * READ keys STRICTLY on the salted hash of the PROVEN signer's wallet (never a URL,
//     never a client-supplied address), so no one can ever see another payee's income.
//
// Recipient wallets are salt-hashed with the shared WALLET_SALT scheme; the payer
// (agency) is stored in the clear because it is public on-chain and the payee needs to
// see who paid them. Names never leave the device.

import { hashWalletAddress } from "@/lib/crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { NETWORK } from "@/lib/tron/config"
import { verifyDisperseTx } from "@/lib/tron/serverRead"

/** Read WALLET_SALT (server-only). Shared pepper across OFAC + free-tier + referrals. */
function requireWalletSalt(): string {
  const value = process.env.WALLET_SALT
  if (!value) {
    throw new Error("WALLET_SALT is not set (server-only secret; see .env.local.example).")
  }
  return value
}

export type RecordDisperseResult = {
  /** True when the tx verified as a real PurserPay USDT disperse and rows were upserted. */
  ok: boolean
  /** Rows newly inserted (0 on an idempotent re-record of an already-indexed tx). */
  recorded: number
  /** Machine reason when !ok (from verifyDisperseTx). */
  reason?: string
}

/**
 * Record a confirmed disperse into the receipt index, GOING FORWARD. Derives every
 * stored field from the tx's authoritative on-chain calldata (verifyDisperseTx) — the
 * client's POST carries only the public txid, nothing trusted. Idempotent (the RPC's
 * unique (txid, recipient_wallet_hash) + on-conflict-do-nothing), so a duplicate POST
 * records 0. A non-verifying tx records nothing and returns { ok:false, reason }.
 */
export async function recordDisperse(txid: string): Promise<RecordDisperseResult> {
  const check = await verifyDisperseTx(txid)
  if (!check.ok || !check.recipients || !check.amounts || !check.payer) {
    return { ok: false, recorded: 0, reason: check.reason ?? "verify_failed" }
  }

  const salt = requireWalletSalt()
  const recipientHashes = check.recipients.map((addr) => hashWalletAddress(addr, salt))
  const blockTs =
    check.blockTimeMs != null ? new Date(check.blockTimeMs).toISOString() : null

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("record_disperse_receipts", {
    p_txid: txid,
    p_payer: check.payer,
    p_network: NETWORK.key,
    p_block_ts: blockTs,
    p_recipient_hashes: recipientHashes,
    p_amounts: check.amounts,
  })
  if (error) throw new Error(`record_disperse_receipts failed: ${error.message}`)
  return { ok: true, recorded: typeof data === "number" ? data : Number(data ?? 0) }
}

export type AffiliateReceipt = {
  /** The paying agency wallet (base58, public). */
  payerWallet: string
  /** Amount in USDT base units (stringified uint). */
  amountBaseUnits: string
  /** The disperse batch txid (the on-chain proof; links to Tronscan). */
  txid: string
  /** Network the payout happened on (nile | mainnet). */
  network: string
  /** Block time (ISO) if known, else null. */
  blockTs: string | null
  /** When we indexed it (ISO) — the read's tiebreaker/fallback ordering key. */
  recordedAt: string
}

/**
 * A payee's own disperse-anchored receipts, newest first. `recipientWalletHash` MUST be
 * the salted hash of the PROVEN signer (the history route computes it only after
 * verifyChallenge succeeds). This is the sole airtight anti-leak: a viewer sees exactly
 * and only the payouts made to the wallet they just proved they control.
 */
export async function affiliateReceipts(
  recipientWalletHash: string
): Promise<AffiliateReceipt[]> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("affiliate_receipts", {
    p_recipient_wallet_hash: recipientWalletHash,
  })
  if (error) throw new Error(`affiliate_receipts failed: ${error.message}`)
  const rows = Array.isArray(data) ? data : []
  return rows.map((r) => ({
    payerWallet: String(r.payer_wallet),
    amountBaseUnits: String(r.amount_base_units),
    txid: String(r.txid),
    network: String(r.network),
    blockTs: r.block_ts != null ? String(r.block_ts) : null,
    recordedAt: String(r.recorded_at),
  }))
}

export type ReceiptDetail = AffiliateReceipt & {
  /** The verifiable Audit ID (docs/09 §5) — the stored `audit_id` generated column
   *  (supabase/migrations/0006_receipt_audit.sql), NEVER derived here. */
  auditId: string
}

/**
 * A SINGLE receipt for the 1B PDF download (Sprint 1B). Keyed on BOTH the disperse
 * txid AND the salted hash of the PROVEN signer — the route derives the hash after
 * verifyChallenge, so `txid` is only a selector WITHIN the signer's own data. A txid
 * the signer was not paid in returns null (never another payee's receipt). Reads ONLY
 * disperse_receipts — the grant-only invariant holds: this read path never touches the
 * referral-reward ledger.
 */
export async function receiptDetail(
  txid: string,
  recipientWalletHash: string
): Promise<ReceiptDetail | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("receipt_detail", {
    p_txid: txid,
    p_recipient_wallet_hash: recipientWalletHash,
  })
  if (error) throw new Error(`receipt_detail failed: ${error.message}`)
  const rows = Array.isArray(data) ? data : []
  const r = rows[0]
  if (!r) return null
  return {
    payerWallet: String(r.payer_wallet),
    amountBaseUnits: String(r.amount_base_units),
    txid: String(r.txid),
    network: String(r.network),
    blockTs: r.block_ts != null ? String(r.block_ts) : null,
    recordedAt: String(r.recorded_at),
    auditId: String(r.audit_id),
  }
}
