// The wallet-control VERIFICATION decision — pure, dependency-injected, and free of
// any Supabase / Next / TronWeb import so it can be exhaustively unit-tested with
// fakes (see tests/challenge/verify.test.ts). The server module
// (src/lib/payout/challenge.ts) wires the real dependencies; the route
// (src/app/api/payout/authorize/route.ts) runs this BEFORE any quota/credit is
// touched.
//
// Order (per the sprint):
//   1) Atomically CONSUME the single-use nonce (bound to the payer's wallet hash).
//      No row => the challenge is unknown / used / expired / issued for another
//      address => invalid. This is the replay + TOCTOU defense (one guarded UPDATE).
//   2) Reconstruct the exact signed message from the payer address, the nonce, and
//      the challenge's stored expiry, recover the signer offline, and assert it
//      equals the payer. Mismatch => the caller doesn't control the address.
//
// A failure here NEVER consumes a free-tier slot or a credit month — the route
// returns before authorizePayout runs. The only thing a bad attempt burns is the
// nonce it presented (which the presenter requested for themselves).
//
// Zero imports by design (like freeTier/gate.ts): every effect — the message
// format included — is an injected dep, so this module is trivially unit-testable
// and node --test can load it without any relative-module resolution.

export type ChallengeVerifyInput = {
  /** The self-asserted payer address (base58). Proven, not trusted, below. */
  address: string
  /** The challenge nonce the client echoes back. */
  nonce: string
  /** The client's signature over the challenge message (signMessageV2). */
  signature: string
}

export type ChallengeVerifyDeps = {
  /** Salted wallet hash (WALLET_SALT) — binds the nonce to this address. */
  hash(address: string): string
  /** ATOMIC single-use consume. Returns the challenge's stored expiry (ISO) when a
   *  matching UNUSED, UNEXPIRED nonce for `walletHash` was consumed just now; null
   *  otherwise (unknown / used / expired / wrong address). Throws => fail closed. */
  consume(nonce: string, walletHash: string): Promise<{ expiresIso: string } | null>
  /** Rebuild the EXACT message the wallet signed, from the same inputs used at issue
   *  time (buildChallengeMessage). Injected so the format lives in one place and this
   *  module stays import-free. */
  buildMessage(address: string, nonce: string, expiresIso: string): string
  /** Recover the base58 signer of a signMessageV2 message, offline (ec-recover). */
  recoverSigner(message: string, signature: string): Promise<string>
  /** Normalize an address to a comparable form (hex, lowercased) so a canonical
   *  vs. non-canonical base58 never causes a false mismatch. */
  toHex(address: string): string
}

export type ChallengeVerifyResult =
  | { ok: true }
  | { ok: false; reason: "challenge_invalid" | "signer_mismatch" | "read_error" }

/**
 * Prove the caller controls `address`: consume its single-use challenge, then check
 * the signature recovers `address`. Pure control flow — every side effect is a dep.
 *
 * A thrown dependency (consume / recoverSigner) is caught and reported as
 * `read_error` so the route can fail closed (403) rather than 500 — nothing
 * downstream is ever reached on an error.
 */
export async function verifyWalletControl(
  input: ChallengeVerifyInput,
  deps: ChallengeVerifyDeps
): Promise<ChallengeVerifyResult> {
  try {
    const walletHash = deps.hash(input.address)

    // 1) Atomic single-use consume (replay + TOCTOU defense). No row => invalid.
    const consumed = await deps.consume(input.nonce, walletHash)
    if (!consumed) return { ok: false, reason: "challenge_invalid" }

    // 2) Reconstruct the exact signed message and recover the signer offline.
    const message = deps.buildMessage(input.address, input.nonce, consumed.expiresIso)
    const signer = await deps.recoverSigner(message, input.signature)
    if (deps.toHex(signer) !== deps.toHex(input.address)) {
      return { ok: false, reason: "signer_mismatch" }
    }

    return { ok: true }
  } catch {
    // Any dep failure => fail closed. The nonce may or may not have been consumed;
    // either way nothing downstream runs.
    return { ok: false, reason: "read_error" }
  }
}
