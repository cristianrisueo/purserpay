// Eager, throttled, CANCELABLE blacklist-read queue (Sprint UX-1) — the client-side scheduler that
// runs the frozen-address pre-flight when rows ENTER the roster (import / add-payee / load), instead
// of only at pay time. Pure and dependency-free (no `@/`, no timers of its own unless asked): the
// batch reader, the sleep, the cancel signal, and the result sink are all INJECTED, so it is directly
// unit-testable under `node --test` with zero real timers (mirroring blacklist.ts's injection style).
//
// Why a queue: TronGrid rate-limits (~15 reads/s). Reading a whole 100-row roster at once would trip
// it and degrade every read to UNVERIFIED. So reads go out in SEQUENTIAL batches of ≤10 with a ~1s
// gap — a safe margin — and rows awaiting their turn render the neutral "Verifying…" state (never a
// resolved badge, never "safe").
//
// D-7 (non-negotiable): a batch whose read THROWS resolves every address in it to UNVERIFIED, never
// SAFE — a failed read must never render green. (Per-address failures already map to UNVERIFIED inside
// readBatchBlacklist → readBlacklistStatuses; this covers the whole-batch/action-level throw.)
//
// Cancellation: the caller bumps a generation token when the roster changes; `isCancelled()` is
// checked before each batch AND before applying each batch's results, so a read in flight when the
// roster changes is DROPPED, never applied. Results are keyed by ADDRESS (never row id/index), so an
// applied reading can only ever paint the address it was read for — it can never land on another row.

/** Mirrors BlacklistStatus in blacklist.ts. Duplicated as a literal union so this module stays
 *  self-contained (no cross-module import) and node-testable. */
export type QueueBlacklistStatus = "SAFE" | "FROZEN" | "UNVERIFIED"

/** Reads a batch of addresses, returning `[address, status]` entries — exactly the shape of the
 *  `readBatchBlacklist` server action. MUST resolve (per-address failures already map to UNVERIFIED
 *  inside it); a whole-batch throw is caught here and mapped to UNVERIFIED (D-7). */
export type BatchBlacklistReader = (
  addresses: string[]
) => Promise<Array<[string, QueueBlacklistStatus]>>

export type ThrottledQueueOptions = {
  /** Addresses per batch. Clamped to [1, 10] — ≤10/s under TronGrid's limit. Default 10. */
  batchSize?: number
  /** Delay between sequential batches, in ms. Default 1000 (one batch per second). */
  intervalMs?: number
  /** Injected sleep (tests pass an immediate/counting fake; prod uses setTimeout). */
  sleep?: (ms: number) => Promise<void>
  /** Checked before each batch and before applying results — true ⇒ stop and drop everything after. */
  isCancelled?: () => boolean
  /** Result sink, called once per completed (non-cancelled) batch with that batch's entries. */
  onBatch?: (entries: Array<[string, QueueBlacklistStatus]>) => void
}

/** Batch cap — never read more than this many addresses per round-trip (rate-limit safety). */
const MAX_BATCH = 10
/** Default gap between sequential batches (ms) — one batch per second. */
const DEFAULT_INTERVAL_MS = 1000

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Read the blacklist status of `addresses` in throttled, sequential, cancelable batches.
 *
 * - Dedupes to unique, non-blank addresses (one read per wallet).
 * - Emits each batch's `[address, status]` entries via `onBatch` as they resolve (so rows can flip
 *   out of "Verifying…" incrementally), UNLESS cancelled.
 * - A whole-batch read failure → every address in that batch emitted as UNVERIFIED (D-7).
 * - Between batches, awaits `sleep(intervalMs)` — the throttle. No sleep after the last batch.
 *
 * Resolves when every batch has completed or the run was cancelled. Never rejects.
 */
export async function runThrottledBlacklist(
  addresses: readonly string[],
  read: BatchBlacklistReader,
  opts: ThrottledQueueOptions = {}
): Promise<void> {
  const unique = [
    ...new Set(
      (addresses ?? []).filter((a) => typeof a === "string" && a.trim() !== "")
    ),
  ]
  if (unique.length === 0) return

  const size = Math.max(1, Math.min(opts.batchSize ?? MAX_BATCH, MAX_BATCH))
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const sleep = opts.sleep ?? defaultSleep
  const isCancelled = opts.isCancelled ?? (() => false)

  for (let i = 0; i < unique.length; i += size) {
    // Roster changed before this batch went out → stop; nothing more is read or applied.
    if (isCancelled()) return

    const batch = unique.slice(i, i + size)
    let entries: Array<[string, QueueBlacklistStatus]>
    try {
      entries = await read(batch)
    } catch {
      // D-7: a whole-batch/action-level failure leaves NOTHING safe — every address UNVERIFIED.
      entries = batch.map((a) => [a, "UNVERIFIED"] as [string, QueueBlacklistStatus])
    }

    // Roster changed WHILE this batch was in flight → discard these results, never apply them.
    if (isCancelled()) return
    opts.onBatch?.(entries)

    // Throttle: pause before the next batch (not after the last).
    if (i + size < unique.length) await sleep(intervalMs)
  }
}
