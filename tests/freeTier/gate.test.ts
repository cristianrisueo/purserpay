// Unit tests for the Free-Tier authorization DECISION and the refund decision.
// Pure logic, injected fakes — no Supabase, no TronWeb, no network. Run with:
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")
//
// The genuine 30-day TOCTOU/atomicity guarantee is a property of Postgres and is
// proven separately in toctou.integration.test.ts against a real DB.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  authorizePayout,
  FREE_TIER_COOLDOWN_MS,
  type AuthzDeps,
} from "../../src/lib/freeTier/gate.ts"
import { shouldRestoreSlot } from "../../src/lib/freeTier/refund.ts"

const PAYER = "TPayerWalletAddrPlaceholder000000000"
const R1 = ["TRecipientAddrOne00000000000000000000"]
const R2 = [
  "TRecipientAddrOne00000000000000000000",
  "TRecipientAddrTwo00000000000000000000",
]

type Spied = AuthzDeps & {
  readonly screenCalls: number
  readonly subCalls: number
  readonly consumeCalls: number
}

/** Build deps with per-call spies (live-read via getters). `consumeQuota` models
 *  consume_free_tier's 30-day rule against an in-memory lastAt, so day-29/day-31
 *  boundaries are deterministic. */
function makeDeps(opts: {
  flagged?: string[]
  subscribed?: boolean | null
  quotaLastAtMs?: number | null // null => fresh (never used)
  nowMs?: number
}): Spied {
  const counters = { screen: 0, sub: 0, consume: 0 }
  let lastAtMs = opts.quotaLastAtMs ?? null
  const nowMs = opts.nowMs ?? Date.UTC(2026, 6, 13) // 2026-07-13

  const deps: AuthzDeps = {
    async screen() {
      counters.screen++
      return opts.flagged ?? []
    },
    async isSubscribed() {
      counters.sub++
      // Preserve an explicit null (unverifiable); default only undefined to false.
      return opts.subscribed === undefined ? false : opts.subscribed
    },
    async consumeQuota() {
      counters.consume++
      // Mirror consume_free_tier: consume iff no prior use or >= 30 days elapsed.
      if (lastAtMs == null || nowMs - lastAtMs >= FREE_TIER_COOLDOWN_MS) {
        lastAtMs = nowMs
        return { consumed: true, at: new Date(nowMs).toISOString() }
      }
      return { consumed: false, at: new Date(lastAtMs).toISOString() }
    },
  }

  return Object.assign(deps, {
    get screenCalls() {
      return counters.screen
    },
    get subCalls() {
      return counters.sub
    },
    get consumeCalls() {
      return counters.consume
    },
  }) as Spied
}

test("subscriber bypasses the quota entirely", async () => {
  const deps = makeDeps({ subscribed: true })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R2 }, deps)
  assert.deepEqual(res, { ok: true, mode: "subscription" })
  assert.equal(deps.consumeCalls, 0, "quota must not be touched for a subscriber")
})

test("free tier: count > 1 is blocked (BATCH_LIMIT), quota untouched", async () => {
  const deps = makeDeps({ subscribed: false })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R2 }, deps)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, "FREE_TIER_BATCH_LIMIT")
  assert.equal(deps.consumeCalls, 0)
})

test("free tier: count === 1, first time, is authorized", async () => {
  const now = Date.UTC(2026, 6, 13)
  const deps = makeDeps({ subscribed: false, quotaLastAtMs: null, nowMs: now })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, deps)
  assert.equal(res.ok, true)
  assert.equal(res.ok === true && res.mode, "free")
  assert.equal(
    res.ok === true && res.mode === "free" && res.consumedAt,
    new Date(now).toISOString()
  )
})

test("free tier: same wallet again at day 29 is blocked with a cooldown", async () => {
  const now = Date.UTC(2026, 6, 13)
  const day29 = now - 29 * 24 * 60 * 60 * 1000
  const deps = makeDeps({ subscribed: false, quotaLastAtMs: day29, nowMs: now })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, deps)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, "FREE_TIER_COOLDOWN")
  // nextAvailableAt = last used (day29) + 30 days.
  assert.equal(
    res.ok === false && res.code === "FREE_TIER_COOLDOWN" && res.nextAvailableAt,
    new Date(day29 + FREE_TIER_COOLDOWN_MS).toISOString()
  )
})

test("free tier: same wallet at day 31 is allowed again", async () => {
  const now = Date.UTC(2026, 6, 13)
  const day31 = now - 31 * 24 * 60 * 60 * 1000
  const deps = makeDeps({ subscribed: false, quotaLastAtMs: day31, nowMs: now })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, deps)
  assert.equal(res.ok, true)
  assert.equal(res.ok === true && res.mode, "free")
})

test("OFAC hit blocks the whole batch before subscription/quota are read", async () => {
  const deps = makeDeps({ flagged: R1, subscribed: true })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, deps)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, "OFAC_BLOCKED")
  assert.deepEqual(res.ok === false && res.code === "OFAC_BLOCKED" ? res.flagged : null, R1)
  assert.equal(deps.subCalls, 0, "subscription is not read once OFAC blocks")
  assert.equal(deps.consumeCalls, 0)
})

test("unverifiable subscription fails closed (no quota consumed)", async () => {
  const deps = makeDeps({ subscribed: null })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, deps)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, "SUBSCRIPTION_UNVERIFIABLE")
  assert.equal(deps.consumeCalls, 0, "must never burn a real subscriber's slot on an unreadable sub")
})

test("a thrown OFAC screen propagates (route fails closed)", async () => {
  const deps: AuthzDeps = {
    async screen() {
      throw new Error("db down")
    },
    async isSubscribed() {
      return false
    },
    async consumeQuota() {
      return { consumed: true, at: new Date().toISOString() }
    },
  }
  await assert.rejects(
    () => authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, deps),
    /db down/
  )
})

test("refund decision matrix (shouldRestoreSlot)", () => {
  // No broadcast (wallet rejection) → restore.
  assert.equal(shouldRestoreSlot(null, null), true)
  assert.equal(shouldRestoreSlot("", null), true)
  // Broadcast + proven failure → restore.
  assert.equal(shouldRestoreSlot("0xabc", "failed"), true)
  // Broadcast + success → never restore (money moved).
  assert.equal(shouldRestoreSlot("0xabc", "success"), false)
  // Broadcast + unverifiable → fail closed, do not restore.
  assert.equal(shouldRestoreSlot("0xabc", "unknown"), false)
})
