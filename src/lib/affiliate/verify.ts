import "server-only"

// Server-only bridge for the PUBLIC receipt verification page (/verify/[txid]).
//
// This is the anti-Photoshop path (docs/09 §5, D4). It takes ONLY (txid, auditId)
// — both already public-safe: txid is public on-chain, auditId is an opaque,
// non-reversible salted-hash digest that reveals no wallet — and returns the batch
// facts that are ALREADY public on-chain for that txid: amount, paying agency,
// network, block time.
//
// The amount it returns is the INDEX truth (disperse_receipts, populated by
// verifyDisperseTx from on-chain calldata), NEVER a query parameter. So if a payee
// hand-edits the amount on their PDF and prints it, this page shows the real amount
// and the mismatch is exposed. verify_receipt() also never returns the recipient
// hash — the verification leaks nothing beyond what the batch txid already exposes.

import { createSupabaseServiceClient } from "@/lib/supabase/server"

export type VerifiedReceipt = {
  /** The paying agency wallet (base58, public on-chain). */
  payerWallet: string
  /** Amount in USDT base units (stringified uint) — index truth, never client input. */
  amountBaseUnits: string
  /** Network the payout happened on (nile | mainnet). */
  network: string
  /** Block time (ISO) if known, else null. */
  blockTs: string | null
  /** The Audit ID this row resolves to (echoed back for display). */
  auditId: string
}

/**
 * Resolve a receipt for the public verification page. Returns the matching row's
 * public-safe fields, or null if (txid, auditId) matches nothing (a forged Audit
 * ID, a tampered link, or a txid we never indexed). Keyed on the stored `audit_id`
 * generated column — no recipient hash in, no recipient hash out.
 */
export async function verifyReceipt(
  txid: string,
  auditId: string
): Promise<VerifiedReceipt | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("verify_receipt", {
    p_txid: txid,
    p_audit_id: auditId,
  })
  if (error) throw new Error(`verify_receipt failed: ${error.message}`)
  const rows = Array.isArray(data) ? data : []
  const r = rows[0]
  if (!r) return null
  return {
    payerWallet: String(r.payer_wallet),
    amountBaseUnits: String(r.amount_base_units),
    network: String(r.network),
    blockTs: r.block_ts != null ? String(r.block_ts) : null,
    auditId: String(r.audit_id),
  }
}
