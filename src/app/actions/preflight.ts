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

import type { BlacklistStatus, PreflightCell } from "@/lib/security/blacklist"
import {
  readDestinationBlacklist,
  readDestinationPreflight,
} from "@/lib/tron/serverRead"

/**
 * Read USDT's blacklist status for a payout batch's addresses (the payer + every recipient),
 * server-side and fail-safe. Returns `Map.entries()` as a plain array so the value is
 * structured-clone serializable across the Server Action boundary; the client rebuilds a Map
 * and feeds it to the pure `previewBatch`. Dedup + bounded concurrency + the D-7 fail-safe all
 * live in `readDestinationBlacklist` / `readBlacklistStatuses`; this adds nothing but the seam.
 *
 * Still used at PAY TIME (frozen-only re-confirm) — the eager roster pass uses readBatchPreflight
 * below, which also carries the resource pre-check's fresh-vs-holder signal.
 */
export async function readBatchBlacklist(
  addresses: string[]
): Promise<Array<[string, BlacklistStatus]>> {
  const statuses = await readDestinationBlacklist(addresses)
  return [...statuses.entries()]
}

/**
 * The COMBINED eager pre-flight read (Sprint: toolbar resource pre-check): each address's frozen
 * status AND whether it holds USDT, in one server round-trip per batch. Same server-only seam +
 * TRON_PRO_API_KEY as readBatchBlacklist — the browser never sees the key or the read client. The
 * `holdsUsdt` half feeds the fresh-vs-holder energy estimate (null = unknown → treated as FRESH).
 * Already serialization-safe (strings / booleans / null). See docs/03.
 */
export async function readBatchPreflight(
  addresses: string[]
): Promise<Array<[string, PreflightCell]>> {
  return readDestinationPreflight(addresses)
}
