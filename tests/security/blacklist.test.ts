// Sprint S-2 — the FAIL-SAFE blacklist read (D-7). A read that fails/times-out/rate-limits
// must be UNVERIFIED, NEVER SAFE — a failure can never render green. Reads are deduped (one
// per unique address) to respect TronGrid's rate limit. Pure: the RPC read is injected.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  readBlacklistStatuses,
  type BlacklistReader,
} from "../../src/lib/security/blacklist.ts"

const FROZEN = "TFrozen0000000000000000000000000a"
const CLEAN = "TClean00000000000000000000000000b"
const BOOM = "TBoom000000000000000000000000000c"

/** A reader driven by a fixed map; addresses mapped to `throw` reject (RPC failure). */
function readerFrom(map: Record<string, boolean | "throw">, calls?: string[]): BlacklistReader {
  return async (address: string) => {
    calls?.push(address)
    const v = map[address]
    if (v === "throw" || v === undefined) throw new Error("rpc failed")
    return v
  }
}

test("frozen address → FROZEN", async () => {
  const out = await readBlacklistStatuses([FROZEN], readerFrom({ [FROZEN]: true }))
  assert.equal(out.get(FROZEN), "FROZEN")
})

test("clean address → SAFE", async () => {
  const out = await readBlacklistStatuses([CLEAN], readerFrom({ [CLEAN]: false }))
  assert.equal(out.get(CLEAN), "SAFE")
})

test("D-7: a read that THROWS → UNVERIFIED, never SAFE", async () => {
  const out = await readBlacklistStatuses([BOOM], readerFrom({ [BOOM]: "throw" }))
  assert.equal(out.get(BOOM), "UNVERIFIED")
  assert.notEqual(out.get(BOOM), "SAFE")
})

test("D-7: a read that never resolves (timeout) → UNVERIFIED, never SAFE", async () => {
  // A reader that rejects models a timeout/abort; the classifier must not fall through to SAFE.
  const timeoutReader: BlacklistReader = async () => {
    throw new Error("ETIMEDOUT")
  }
  const out = await readBlacklistStatuses([CLEAN], timeoutReader)
  assert.equal(out.get(CLEAN), "UNVERIFIED")
})

test("D-7: if EVERY read fails, nothing is SAFE", async () => {
  const out = await readBlacklistStatuses([FROZEN, CLEAN, BOOM], async () => {
    throw new Error("down")
  })
  for (const v of out.values()) assert.notEqual(v, "SAFE")
  assert.equal([...out.values()].every((v) => v === "UNVERIFIED"), true)
})

test("reads are DEDUPED — one read per unique address", async () => {
  const calls: string[] = []
  const reader = readerFrom({ [FROZEN]: true, [CLEAN]: false }, calls)
  const out = await readBlacklistStatuses([FROZEN, FROZEN, CLEAN, FROZEN, CLEAN], reader)
  // 5 inputs, 2 unique → exactly 2 reads.
  assert.equal(calls.length, 2)
  assert.deepEqual([...calls].sort(), [CLEAN, FROZEN].sort())
  assert.equal(out.size, 2)
})

test("blank / non-string addresses are skipped (not read, not in the map)", async () => {
  const calls: string[] = []
  const reader = readerFrom({ [CLEAN]: false }, calls)
  const out = await readBlacklistStatuses(
    [CLEAN, "", "   ", null as unknown as string],
    reader
  )
  assert.equal(calls.length, 1)
  assert.equal(out.size, 1)
  assert.equal(out.get(CLEAN), "SAFE")
})

test("mixed batch → each classified independently (a failure never poisons a sibling)", async () => {
  const out = await readBlacklistStatuses(
    [FROZEN, CLEAN, BOOM],
    readerFrom({ [FROZEN]: true, [CLEAN]: false, [BOOM]: "throw" })
  )
  assert.equal(out.get(FROZEN), "FROZEN")
  assert.equal(out.get(CLEAN), "SAFE")
  assert.equal(out.get(BOOM), "UNVERIFIED")
})
