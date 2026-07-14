// The USDT-TRC20 allowance dance, in one place, honoring mainnet's reset rule.
//
// Mainnet USDT-TRC20's approve(spender, value) REVERTS unless
// `allowance == 0 || value == 0` — a well-known guard against the classic
// approve race. Nile's mock token has no such rule, which is exactly why the
// bug below never surfaced in testing. The reachable failure: a user approves
// 150 (monthly), abandons before signing subscribe, returns and picks annual, so
// we call approve(1500) against a standing allowance of 150 → the mainnet token
// reverts and that user can NEVER subscribe again.
//
// The fix, applied at every approve site (disperse.ts + subscription.ts): when a
// non-zero allowance is too small, reset it to 0 FIRST (confirmed by receipt),
// THEN approve the amount we need. That means the user sees TWO wallet prompts on
// that one path — a surprise second signature is a fear event (Law of UX #2), so
// the caller announces it via onApproveReset.
//
// This module is deliberately dependency-free: the on-chain primitives (approve +
// receipt confirmation) are injected, so the three branches are unit-testable with
// plain fakes and the reset ORDER can be asserted without a wallet or a network.

/** The two on-chain primitives ensureAllowance drives, injected by the caller so
 *  this stays testable. `approve` returns the broadcast txid; `confirm` resolves
 *  once the tx is mined SUCCESS and THROWS (a calm PurserError) otherwise. */
export type AllowanceDeps = {
  approve: (spender: string, value: bigint) => Promise<string>
  confirm: (txid: string) => Promise<void>
}

export type AllowanceEvents = {
  /** An approve is needed and about to be requested (allowance was short). */
  onApproveStart?: () => void
  /** A non-zero allowance must be cleared to 0 before re-approving — the user is
   *  about to see an EXTRA (first) wallet prompt. Announce it calmly. */
  onApproveReset?: () => void
}

/** What ensureAllowance did on-chain. Both undefined when the standing allowance
 *  already sufficed (no signature at all). `resetTxid` is set only on the
 *  non-zero-but-short path (the mainnet reset). */
export type AllowanceResult = { resetTxid?: string; approveTxid?: string }

/**
 * Bring `spender`'s USDT allowance from `current` up to at least `needed`,
 * honoring mainnet USDT-TRC20's `approve(allowance == 0 || value == 0)` rule.
 *
 * Three branches:
 *   1. current >= needed        → nothing to do (no tx, no prompt).
 *   2. current == 0             → onApproveStart → approve(spender, needed).
 *   3. 0 < current < needed     → onApproveReset → approve(spender, 0) → confirm
 *                                 → onApproveStart → approve(spender, needed) → confirm.
 *
 * Event order tracks what the user is actually signing: onApproveReset labels the
 * FIRST prompt ("clearing your previous approval"), then onApproveStart labels the
 * SECOND ("approving"). The reset is confirmed by receipt BEFORE the second approve
 * is requested (the `await` on `confirm(resetTxid)` guarantees the tx order), so the
 * token never sees a non-zero→non-zero approve.
 */
export async function ensureAllowance(
  current: bigint,
  needed: bigint,
  spender: string,
  deps: AllowanceDeps,
  events: AllowanceEvents = {}
): Promise<AllowanceResult> {
  if (current >= needed) return {}

  const result: AllowanceResult = {}

  // Non-zero but insufficient: clear to 0 first (mainnet requires it), warning
  // the user about the extra signature BEFORE the first wallet prompt pops.
  if (current > 0n) {
    events.onApproveReset?.()
    const resetTxid = await deps.approve(spender, 0n)
    await deps.confirm(resetTxid)
    result.resetTxid = resetTxid
  }

  // Now set the allowance we actually need (from a guaranteed-zero base on the
  // reset path). This is the "approving" step the caller already knows.
  events.onApproveStart?.()
  const approveTxid = await deps.approve(spender, needed)
  await deps.confirm(approveTxid)
  result.approveTxid = approveTxid
  return result
}
