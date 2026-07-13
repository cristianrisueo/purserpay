// The Free-Tier authorization DECISION — pure, dependency-injected, and free of
// any Supabase / Next / TronWeb import so it can be exhaustively unit-tested with
// fakes (see tests/freeTier/gate.test.ts). The route handler
// (src/app/api/payout/authorize/route.ts) wires the real dependencies.
//
// Order of checks (per the sprint):
//   1) OFAC screen ALL recipients — a hit blocks the whole batch (atomic).
//   2) Subscription — active => allow UNLIMITED, no quota touched. Unverifiable
//      => fail closed (block, consume nothing).
//   3) Free tier — count > 1 => blocked; count === 1 => atomically consume the
//      quota (row => authorized; no row => cooldown).
//
// disperse() is permissionless and immutable — this gate CANNOT be enforced
// on-chain and is an off-chain licence gate. See docs/07-freemium-gate.md.

/** 30 days in ms — the free-tier cooldown window (mirrors the SQL interval). */
export const FREE_TIER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

export type AuthzInput = {
  payerAddress: string
  /** One address per selected payee row (duplicates allowed = duplicate payees).
   *  The COUNT authority is this array's length, never a client-sent number. */
  recipientAddresses: string[]
}

export type AuthzDeps = {
  /** OFAC screen — returns the ORIGINAL sanctioned addresses ([] = clean). Throws
   *  => the route fails closed. */
  screen(addresses: string[]): Promise<string[]>
  /** Server-side subscription read. true = active, false = none, null =
   *  UNVERIFIABLE (contract undeployed / RPC failure). */
  isSubscribed(payerAddress: string): Promise<boolean | null>
  /** Atomic quota consume for the payer. { consumed, at } — on block `at` is the
   *  existing last_free_payout_at so we can compute the cooldown. */
  consumeQuota(payerAddress: string): Promise<{ consumed: boolean; at: string | null }>
}

export type AuthzResult =
  | { ok: true; mode: "subscription" }
  | { ok: true; mode: "free"; consumedAt: string }
  | { ok: false; code: "OFAC_BLOCKED"; flagged: string[] } // 403
  | { ok: false; code: "FREE_TIER_BATCH_LIMIT" } // 402
  | { ok: false; code: "FREE_TIER_COOLDOWN"; nextAvailableAt: string } // 402
  | { ok: false; code: "SUBSCRIPTION_UNVERIFIABLE" } // 503

/** ISO cooldown end = (existing last_free_payout_at) + 30 days. */
function nextAvailableFrom(at: string | null): string {
  const base = at != null ? new Date(at).getTime() : NaN
  const anchor = Number.isFinite(base) ? base : Date.now()
  return new Date(anchor + FREE_TIER_COOLDOWN_MS).toISOString()
}

/**
 * Decide whether a payout may proceed. Never signs, never broadcasts — it only
 * screens, reads the subscription, and (for count === 1) atomically consumes the
 * free slot OPTIMISTICALLY, before the client broadcasts.
 *
 * A thrown dependency (screen / consume) propagates so the route fails closed.
 */
export async function authorizePayout(
  input: AuthzInput,
  deps: AuthzDeps
): Promise<AuthzResult> {
  const recipients = input.recipientAddresses ?? []
  const count = recipients.length

  // 1) OFAC — screen everyone; a hit blocks the whole batch.
  const flagged = await deps.screen(recipients)
  if (flagged.length > 0) {
    return { ok: false, code: "OFAC_BLOCKED", flagged }
  }

  // 2) Subscription — active bypasses the quota entirely.
  const subscribed = await deps.isSubscribed(input.payerAddress)
  if (subscribed === null) {
    // Unverifiable => fail closed. Never consume a real subscriber's free slot.
    return { ok: false, code: "SUBSCRIPTION_UNVERIFIABLE" }
  }
  if (subscribed === true) {
    return { ok: true, mode: "subscription" }
  }

  // 3) Free tier — one payee, once every 30 days.
  if (count > 1) {
    return { ok: false, code: "FREE_TIER_BATCH_LIMIT" }
  }

  const { consumed, at } = await deps.consumeQuota(input.payerAddress)
  if (consumed && at != null) {
    return { ok: true, mode: "free", consumedAt: at }
  }
  return { ok: false, code: "FREE_TIER_COOLDOWN", nextAvailableAt: nextAvailableFrom(at) }
}
