// The free-tier REFUND decision — pure and testable (no server imports), so both
// the release route and the unit tests share one source of truth.
//
// A slot is restored only when the payout demonstrably did NOT happen. Never trust
// a client claim of failure: a broadcast tx is re-verified on-chain first.

/** On-chain outcome of a re-verified txid (mirrors serverRead.getTxOutcome). */
export type PayoutOutcome = "success" | "failed" | "unknown"

/**
 * Should the consumed free slot be restored?
 *   - No txid (null/empty): the wallet rejection never broadcast anything → restore
 *     so a misclick doesn't burn the slot.
 *   - A txid: restore ONLY on a proven on-chain "failed". "success" (money moved)
 *     and "unknown" (can't confirm) both FAIL CLOSED → do not restore.
 */
export function shouldRestoreSlot(
  txid: string | null,
  outcome: PayoutOutcome | null
): boolean {
  if (txid == null || txid.trim() === "") return true
  return outcome === "failed"
}
