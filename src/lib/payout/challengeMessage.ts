// The wallet-control challenge message — PURE and portable (no env, no secret, no
// import). Both the server (which builds it at issue time AND reconstructs it at
// verify time) and the tests use this ONE function, so the bytes the wallet signs
// and the bytes the server recovers against are identical by construction.
//
// Format (TIP-191 / signMessageV2 — human-readable so the user can read what they
// sign). The address is trimmed so the issue-time and verify-time strings match
// even if a caller passes stray whitespace (hashing normalizes the same way).
//
//   PurserPay — authorize payout
//   Address: {addr}
//   Nonce: {nonce}
//   Expires: {expiresIso}
//
// `expiresIso` MUST be produced identically on both ends. The server builds it from
// `Date.toISOString()` at issue time and reconstructs it with
// `new Date(row.expires_at).toISOString()` at verify time — a ms-precision instant
// round-trips through Postgres `timestamptz` and back to the canonical `…Z` form
// exactly. See src/lib/payout/challenge.ts.

export function buildChallengeMessage(
  address: string,
  nonce: string,
  expiresIso: string
): string {
  return [
    "PurserPay — authorize payout",
    `Address: ${address.trim()}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresIso}`,
  ].join("\n")
}
