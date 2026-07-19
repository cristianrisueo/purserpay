// The wallet-control challenge message — PURE and portable (no env, no secret, no
// import). Both the server (which builds it at issue time AND reconstructs it at
// verify time) and the tests use this ONE function, so the bytes the wallet signs
// and the bytes the server recovers against are identical by construction.
//
// Format (TIP-191 / signMessageV2 — human-readable so the user can read what they
// sign). The address is trimmed so the issue-time and verify-time strings match
// even if a caller passes stray whitespace (hashing normalizes the same way).
//
//   PurserPay — authorize payout           (payout purpose — the default)
//   Address: {addr}
//   Nonce: {nonce}
//   Expires: {expiresIso}
//
// PURPOSE (payout | portal) — one challenge PRIMITIVE, two intents. The SAME nonce
// table (payout_challenges) + atomic consume RPC + offline recovery serve both; only
// the FIRST line(s) of the signed message differ. The affiliate portal signs a
// distinct "verify wallet to view receipts" message that states it authorizes NO
// on-chain action, so a portal signature can never be mistaken for — or replayed as —
// a payout approval.
//
// Why the purpose needs no DB column: it is bound CRYPTOGRAPHICALLY by the signed
// bytes. A signature over the portal message, replayed to the payout gate, is
// verified against the (different) payout message, so ec-recover yields the wrong
// signer -> signer_mismatch -> rejected. Both ends must simply agree on the purpose
// (the portal route verifies with "portal", the payout gate with "payout").
//
// `expiresIso` MUST be produced identically on both ends. The server builds it from
// `Date.toISOString()` at issue time and reconstructs it with
// `new Date(row.expires_at).toISOString()` at verify time — a ms-precision instant
// round-trips through Postgres `timestamptz` and back to the canonical `…Z` form
// exactly. See src/lib/payout/challenge.ts.

/** What a challenge signature authorizes the caller to do. Bound into the signed
 *  message text (see above), never stored. Defaults to "payout" everywhere so the
 *  existing payout flow is byte-for-byte unchanged. */
export type ChallengePurpose = "payout" | "portal"

/** The purpose-specific heading line(s) that precede the Address/Nonce/Expires
 *  block. "payout" is the original single line (unchanged). */
function purposeHeading(purpose: ChallengePurpose): string[] {
  if (purpose === "portal") {
    return [
      "PurserPay — verify wallet to view receipts",
      "This only verifies your wallet. It authorizes no payment or on-chain action.",
    ]
  }
  return ["PurserPay — authorize payout"]
}

export function buildChallengeMessage(
  address: string,
  nonce: string,
  expiresIso: string,
  purpose: ChallengePurpose = "payout"
): string {
  return [
    ...purposeHeading(purpose),
    `Address: ${address.trim()}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresIso}`,
  ].join("\n")
}
