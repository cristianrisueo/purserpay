// Sprint UX-1 — the eager, throttled, cancelable blacklist-read queue. Pure/injectable: the batch
// reader, sleep, cancel signal, and result sink are all fakes, so batching, throttling, cancellation,
// and the D-7 fail-safe are asserted deterministically with NO real timers.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  runThrottledBlacklist,
  type QueueBlacklistStatus,
} from "../../src/lib/security/preflightQueue.ts"

const safe = (batch: string[]): Array<[string, QueueBlacklistStatus]> =>
  batch.map((a) => [a, "SAFE"] as [string, QueueBlacklistStatus])

const noSleep = async () => {}

// --- dedup ------------------------------------------------------------------

test("dedupes to unique, non-blank addresses (one read per wallet)", async () => {
  const reads: string[][] = []
  await runThrottledBlacklist(
    ["A", "A", "B", "", "   ", "B"],
    async (batch) => {
      reads.push(batch)
      return safe(batch)
    },
    { batchSize: 10, sleep: noSleep }
  )
  assert.deepEqual(reads.flat().sort(), ["A", "B"])
})

test("no addresses → read is never called", async () => {
  let called = false
  await runThrottledBlacklist(
    [],
    async (batch) => {
      called = true
      return safe(batch)
    },
    { sleep: noSleep }
  )
  assert.equal(called, false)
})

// --- batching + throttle ----------------------------------------------------

test("issues sequential batches of ≤batchSize, never all at once; sleeps BETWEEN batches only", async () => {
  const addrs = Array.from({ length: 25 }, (_, i) => `T${i}`)
  const reads: string[][] = []
  let sleepCalls = 0
  await runThrottledBlacklist(
    addrs,
    async (batch) => {
      reads.push(batch)
      return safe(batch)
    },
    {
      batchSize: 10,
      intervalMs: 1000,
      sleep: async () => {
        sleepCalls++
      },
    }
  )
  assert.equal(reads.length, 3) // 10 + 10 + 5 — never one call with all 25
  assert.ok(reads.every((b) => b.length <= 10))
  assert.equal(reads[0].length, 10)
  assert.equal(reads[2].length, 5)
  assert.equal(sleepCalls, 2) // gaps between 3 batches, none after the last
})

test("batchSize is clamped to ≤10 (rate-limit safety) even when a larger size is asked for", async () => {
  const addrs = Array.from({ length: 15 }, (_, i) => `T${i}`)
  const reads: string[][] = []
  await runThrottledBlacklist(
    addrs,
    async (batch) => {
      reads.push(batch)
      return safe(batch)
    },
    { batchSize: 100, sleep: noSleep }
  )
  assert.ok(reads.every((b) => b.length <= 10))
  assert.equal(reads.length, 2) // 10 + 5
})

test("runs strictly sequentially — never more than one batch in flight at a time", async () => {
  const addrs = Array.from({ length: 30 }, (_, i) => `T${i}`)
  let inFlight = 0
  let maxInFlight = 0
  await runThrottledBlacklist(
    addrs,
    async (batch) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return safe(batch)
    },
    { batchSize: 10, sleep: noSleep }
  )
  assert.equal(maxInFlight, 1)
})

// --- cancellation -----------------------------------------------------------

test("cancelled from the start → no batch is ever read", async () => {
  const reads: string[][] = []
  await runThrottledBlacklist(
    ["A", "B"],
    async (batch) => {
      reads.push(batch)
      return safe(batch)
    },
    { batchSize: 1, sleep: noSleep, isCancelled: () => true, onBatch: () => {} }
  )
  assert.equal(reads.length, 0)
})

test("a batch read but cancelled before it lands is DROPPED, never applied", async () => {
  const applied: string[] = []
  let cancelled = false
  await runThrottledBlacklist(
    ["A", "B", "C"],
    async (batch) => {
      // The roster changes WHILE this batch is in flight.
      cancelled = true
      return safe(batch)
    },
    {
      batchSize: 1,
      sleep: noSleep,
      isCancelled: () => cancelled,
      onBatch: (entries) => {
        for (const [a] of entries) applied.push(a)
      },
    }
  )
  // The post-read isCancelled() check fires before onBatch → the first result is discarded, and no
  // later batch is read. A stale reading never paints a (possibly removed) row.
  assert.deepEqual(applied, [])
})

test("cancellation mid-run: earlier batches apply, later ones are dropped", async () => {
  const applied: string[] = []
  let batchesRead = 0
  let cancelled = false
  await runThrottledBlacklist(
    ["A", "B", "C", "D"],
    async (batch) => {
      batchesRead++
      return safe(batch)
    },
    {
      batchSize: 1,
      sleep: async () => {
        if (batchesRead >= 2) cancelled = true // roster changes after 2 rows resolve
      },
      isCancelled: () => cancelled,
      onBatch: (entries) => {
        for (const [a] of entries) applied.push(a)
      },
    }
  )
  assert.deepEqual(applied, ["A", "B"])
  assert.equal(batchesRead, 2) // C is never read; D never reached
})

// --- D-7 fail-safe ----------------------------------------------------------

test("D-7: a whole-batch read failure → every address emitted UNVERIFIED, never SAFE", async () => {
  const applied: Array<[string, QueueBlacklistStatus]> = []
  await runThrottledBlacklist(
    ["A", "B"],
    async () => {
      throw new Error("rate limited")
    },
    {
      batchSize: 10,
      sleep: noSleep,
      onBatch: (entries) => applied.push(...entries),
    }
  )
  assert.deepEqual(applied, [
    ["A", "UNVERIFIED"],
    ["B", "UNVERIFIED"],
  ])
  assert.ok(applied.every(([, st]) => st !== "SAFE"))
})

test("D-7 is per-batch: a failing batch is UNVERIFIED while a healthy batch stays SAFE", async () => {
  const applied = new Map<string, QueueBlacklistStatus>()
  let n = 0
  await runThrottledBlacklist(
    ["A", "B"],
    async (batch) => {
      n++
      if (n === 1) throw new Error("boom") // first batch fails
      return safe(batch)
    },
    {
      batchSize: 1,
      sleep: noSleep,
      onBatch: (entries) => {
        for (const [a, st] of entries) applied.set(a, st)
      },
    }
  )
  assert.equal(applied.get("A"), "UNVERIFIED")
  assert.equal(applied.get("B"), "SAFE")
})
