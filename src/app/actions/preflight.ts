"use server"

// Payout pre-flight Server Action — the client bridge to the server-only frozen-address read.
//
// The dashboard hook (usePayout, a client module) CANNOT import serverRead.ts (it is
// `import "server-only"`, holds the keyless TRON read client, and reuses TRON_PRO_API_KEY).
// This thin "use server" wrapper is the seam — exactly like `verifyRosterCompliance` bridges
// the OFAC screen — so the browser triggers the read WITHOUT ever seeing the API key or the
// read client. Reads only: nothing is signed, no funds move — non-custodial is untouched.
//
// FAIL-SAFE (D-7): `readDestinationBlacklist` maps every per-address read failure to
// UNVERIFIED (never SAFE) inside the pure `readBlacklistStatuses`. The client ALSO wraps this
// call so a catastrophic throw (whole action fails) becomes an all-UNVERIFIED batch — a failed
// read must never render green. The on-chain guard (disperse reverts a frozen destination)
// remains the real guarantee at sign time; this only ever advises.

import type { BlacklistStatus } from "@/lib/security/blacklist"
import { readDestinationBlacklist } from "@/lib/tron/serverRead"

/**
 * Read USDT's blacklist status for a payout batch's addresses (the payer + every recipient),
 * server-side and fail-safe. Returns `Map.entries()` as a plain array so the value is
 * structured-clone serializable across the Server Action boundary; the client rebuilds a Map
 * and feeds it to the pure `previewBatch`. Dedup + bounded concurrency + the D-7 fail-safe all
 * live in `readDestinationBlacklist` / `readBlacklistStatuses`; this adds nothing but the seam.
 */
export async function readBatchBlacklist(
  addresses: string[]
): Promise<Array<[string, BlacklistStatus]>> {
  const statuses = await readDestinationBlacklist(addresses)
  return [...statuses.entries()]
}
