import { createHash } from "node:crypto"

// The Audit ID printed on a 1B receipt PDF and embedded in its verification link.
//
// CANONICAL DEFINITION lives in SQL — the `audit_id` GENERATED STORED column on
// disperse_receipts (supabase/migrations/0006_receipt_audit.sql). Production NEVER
// derives the ID here; every read (receipt_detail / verify_receipt) returns the
// stored column. This function is a Node MIRROR of that exact formula, kept ONLY
// for docs and tests — tests/affiliate/auditId.test.ts asserts it matches the
// generated column for a seeded row, so the two can never drift.
//
//   audit_id = 'PP-' || upper(left(sha256(txid || ':' || recipient_wallet_hash), 16))
//
// Deterministic and stable: the same receipt always yields the same ID.
// recipient_wallet_hash is the SALTED hash (WALLET_SALT), so the Audit ID is
// unforgeable without the pepper and reveals no wallet.
//
// Pure (node:crypto only, no env, no server-only) so it is importable in a plain
// `node --test`, exactly like src/lib/tron/disperseCalldata.ts.

/** Fixed human-recognizable prefix on every Audit ID. */
export const AUDIT_ID_PREFIX = "PP-"

/** The number of leading sha256 hex chars retained after the prefix. */
export const AUDIT_ID_HEX_LEN = 16

/** Mirror of the SQL `audit_id` generated column. `recipientWalletHash` is the
 *  salted wallet hash exactly as stored in disperse_receipts. */
export function auditId(txid: string, recipientWalletHash: string): string {
  const hex = createHash("sha256")
    .update(`${txid}:${recipientWalletHash}`)
    .digest("hex")
  return AUDIT_ID_PREFIX + hex.slice(0, AUDIT_ID_HEX_LEN).toUpperCase()
}
