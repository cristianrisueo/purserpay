import "server-only"

// The referral kill switch. Server-only (no NEXT_PUBLIC_ prefix), so it never
// reaches the client.
//
// DEFAULT OFF: the reward mechanic and the dashboard card stay dark until
// REFERRALS_ENABLED is explicitly truthy. Two things run REGARDLESS of this flag,
// by design:
//   * Attribution (/r/{code} sets the cookie) — the one irreversible bit; an
//     uncaptured click is lost forever.
//   * Honoring EXISTING credit in the payout gate — monotonic: a customer who
//     already earned months can never be locked out by flipping the switch off.
// Only GRANTING new rewards is gated here.

/** True only when REFERRALS_ENABLED is set to a truthy value ("1"/"true"/"yes"/"on"). */
export function referralsEnabled(): boolean {
  const raw = (process.env.REFERRALS_ENABLED ?? "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}
