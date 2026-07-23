// USDT frozen-address (Tether blacklist) pre-flight read — the FAIL-SAFE core.
//
// Real USDT lets a transfer to a blacklisted address SUCCEED and trap the funds forever
// (~3.6% recovery). S-1 put the hard guarantee on-chain (disperse reverts a frozen
// destination). THIS is the advisory pre-flight the dashboard renders BEFORE signing, so
// the operator sees a frozen row instead of an opaque revert.
//
// D-7 (non-negotiable): a read that fails, times out, or is rate-limited is UNVERIFIED —
// NEVER SAFE. A failure must never render as green/safe. The on-chain guard remains the
// real guarantee at sign time; this preview only ever *advises*.
//
// Pure and dependency-free (no `@/`, no server-only) so it is directly unit-testable under
// `node --test`: the actual RPC read is INJECTED (BlacklistReader). serverRead.ts supplies
// the real reader (triggerConstantContract on USDT); tests supply a fake.

/** The three states a destination can be in for the pre-flight. UNVERIFIED is the
 *  fail-safe bucket — it explicitly does NOT assert the address is clean. */
export type BlacklistStatus = "SAFE" | "FROZEN" | "UNVERIFIED"

/** The combined per-address pre-flight signal (Sprint: toolbar resource pre-check): the frozen
 *  status (fail-safe, above) PLUS whether the address currently holds USDT. `holdsUsdt === null`
 *  means the holding read was unavailable → the resource estimate treats it as FRESH (the worst,
 *  most-expensive case — never under-estimates energy). Carried through the same throttled queue as
 *  the frozen read, so both signals arrive in one server round-trip per batch. */
export type PreflightCell = { frozen: BlacklistStatus; holdsUsdt: boolean | null }

/** Reads USDT's `getBlackListStatus(address)` for one address. Resolves `true`
 *  (frozen) or `false` (clean); MUST REJECT on any RPC failure / timeout / rate-limit
 *  so the caller can map it to UNVERIFIED (never SAFE). */
export type BlacklistReader = (address: string) => Promise<boolean>

/** One read per UNIQUE address at a time, to respect TronGrid's rate limit. Small and
 *  fixed — no new dependency, no external limiter. */
const READ_CONCURRENCY = 8

/**
 * Read the blacklist status of a list of destination addresses, fail-safe (D-7).
 *
 * - Dedupes to unique, non-blank addresses (one read per unique address).
 * - Runs the reads in bounded-concurrency chunks (rate-limit friendly).
 * - Maps `true → FROZEN`, `false → SAFE`, and a THROWN read → `UNVERIFIED` — a failed
 *   read is never reported as SAFE.
 *
 * Returns a map keyed by address; every unique input address is present in the result.
 */
export async function readBlacklistStatuses(
  addresses: readonly string[],
  read: BlacklistReader
): Promise<Map<string, BlacklistStatus>> {
  const unique = [
    ...new Set(
      (addresses ?? []).filter((a) => typeof a === "string" && a.trim() !== "")
    ),
  ]

  const out = new Map<string, BlacklistStatus>()

  for (let i = 0; i < unique.length; i += READ_CONCURRENCY) {
    const chunk = unique.slice(i, i + READ_CONCURRENCY)
    await Promise.all(
      chunk.map(async (address) => {
        try {
          const frozen = await read(address)
          out.set(address, frozen ? "FROZEN" : "SAFE")
        } catch {
          // D-7: an unverifiable address is UNVERIFIED, never SAFE.
          out.set(address, "UNVERIFIED")
        }
      })
    )
  }

  return out
}
