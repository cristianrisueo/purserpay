// INTEGRATION test — the point of the sprint: prove the free-tier consume is
// atomic under concurrency (TOCTOU), against a REAL Postgres.
//
// It talks to Supabase directly (service role), so it needs:
//   * env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   * the 0002_free_tier_usage migration applied to that database.
//
// Auto-SKIPS when the env is absent, so `npm test` never fails on a machine
// without a DB. To run it:
//   node --env-file=.env.local --test --experimental-strip-types \
//     "tests/freeTier/toctou.integration.test.ts"
//
// It uses throwaway payer_wallet_hash values (the table stores only a hash string;
// the test can pass any unique string) and cleans them up afterward.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && serviceKey)

const DAY_MS = 24 * 60 * 60 * 1000

function client() {
  return createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** A unique throwaway hash per run — varied so parallel CI runs don't collide. */
function freshHash(tag: string): string {
  return `toctou-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

type ConsumeRow = { consumed: boolean; at: string | null }

async function consume(sb: ReturnType<typeof client>, hash: string): Promise<ConsumeRow> {
  const { data, error } = await sb.rpc("consume_free_tier", { p_wallet_hash: hash })
  if (error) throw new Error(`consume_free_tier: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { consumed: row?.consumed === true, at: row?.at ?? null }
}

test(
  "free-tier quota is atomic + honors the 30-day window (real Postgres)",
  { skip: hasEnv ? false : "set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run" },
  async (t) => {
    const sb = client()

    await t.test("N concurrent consumes → exactly ONE succeeds (TOCTOU)", async () => {
      const hash = freshHash("concurrent")
      try {
        const N = 10
        const results = await Promise.all(
          Array.from({ length: N }, () => consume(sb, hash))
        )
        const wins = results.filter((r) => r.consumed).length
        assert.equal(wins, 1, `exactly one of ${N} concurrent consumes must win, got ${wins}`)
      } finally {
        await sb.from("free_tier_usage").delete().eq("payer_wallet_hash", hash)
      }
    })

    await t.test("same wallet at day 29 blocked, day 31 allowed", async () => {
      const hash = freshHash("window")
      try {
        // First use.
        const first = await consume(sb, hash)
        assert.equal(first.consumed, true, "first free payout must be allowed")

        // Rewind to 29 days ago → still in cooldown.
        await sb
          .from("free_tier_usage")
          .update({ last_free_payout_at: new Date(Date.now() - 29 * DAY_MS).toISOString() })
          .eq("payer_wallet_hash", hash)
        const day29 = await consume(sb, hash)
        assert.equal(day29.consumed, false, "day 29 must be blocked")

        // Rewind to 31 days ago → eligible again.
        await sb
          .from("free_tier_usage")
          .update({ last_free_payout_at: new Date(Date.now() - 31 * DAY_MS).toISOString() })
          .eq("payer_wallet_hash", hash)
        const day31 = await consume(sb, hash)
        assert.equal(day31.consumed, true, "day 31 must be allowed")
      } finally {
        await sb.from("free_tier_usage").delete().eq("payer_wallet_hash", hash)
      }
    })

    await t.test("release restores only the matching consume", async () => {
      const hash = freshHash("release")
      try {
        const consumed = await consume(sb, hash)
        assert.equal(consumed.consumed, true)
        const consumedAt = consumed.at as string

        // A release with a NON-matching timestamp is a no-op (row survives).
        const wrong = new Date(Date.now() - 5 * DAY_MS).toISOString()
        await sb.rpc("release_free_tier", { p_wallet_hash: hash, p_consumed_at: wrong })
        const stillBlocked = await consume(sb, hash)
        assert.equal(stillBlocked.consumed, false, "a mismatched release must not free the slot")

        // The matching release restores eligibility.
        await sb.rpc("release_free_tier", { p_wallet_hash: hash, p_consumed_at: consumedAt })
        const afterRelease = await consume(sb, hash)
        assert.equal(afterRelease.consumed, true, "matching release must restore the slot")
      } finally {
        await sb.from("free_tier_usage").delete().eq("payer_wallet_hash", hash)
      }
    })
  }
)
