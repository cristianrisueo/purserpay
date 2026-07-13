// INTEGRATION test — prove the wallet-control challenge consume is single-use and
// atomic under concurrency (replay + TOCTOU), against a REAL Postgres.
//
// It talks to Supabase directly (service role), so it needs:
//   * env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   * the 0004_payout_challenges migration applied to that database.
//
// Auto-SKIPS when the env is absent, so `npm test` never fails on a machine without
// a DB. To run it:
//   node --env-file=.env.local --test --experimental-strip-types \
//     "tests/challenge/challenge.integration.test.ts"
//
// It uses throwaway nonce + wallet_hash strings (the table stores only strings; any
// unique value works) and cleans them up afterward.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && serviceKey)

function client() {
  return createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Unique throwaway values per run — varied so parallel CI runs don't collide. */
function fresh(tag: string): { nonce: string; hash: string } {
  const salt = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  return { nonce: `chal-nonce-${tag}-${salt}`, hash: `chal-hash-${tag}-${salt}` }
}

async function issue(
  sb: ReturnType<typeof client>,
  nonce: string,
  hash: string,
  expiresAt: string
): Promise<void> {
  const { error } = await sb.rpc("issue_payout_challenge", {
    p_nonce: nonce,
    p_wallet_hash: hash,
    p_expires_at: expiresAt,
  })
  if (error) throw new Error(`issue_payout_challenge: ${error.message}`)
}

/** Returns the challenge's expires_at when consumed, else null (unknown/used/expired/wrong-wallet). */
async function consume(
  sb: ReturnType<typeof client>,
  nonce: string,
  hash: string
): Promise<string | null> {
  const { data, error } = await sb.rpc("consume_payout_challenge", {
    p_nonce: nonce,
    p_wallet_hash: hash,
  })
  if (error) throw new Error(`consume_payout_challenge: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return row?.expires_at ?? null
}

const FIVE_MIN = 5 * 60 * 1000

test(
  "payout challenge consume is single-use + atomic (real Postgres)",
  { skip: hasEnv ? false : "set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run" },
  async (t) => {
    const sb = client()

    await t.test("consume once returns the expiry; a replay returns null (single-use)", async () => {
      const { nonce, hash } = fresh("single-use")
      try {
        await issue(sb, nonce, hash, new Date(Date.now() + FIVE_MIN).toISOString())
        const first = await consume(sb, nonce, hash)
        assert.notEqual(first, null, "first consume must succeed")
        const replay = await consume(sb, nonce, hash)
        assert.equal(replay, null, "a used nonce must never consume again (replay defense)")
      } finally {
        await sb.from("payout_challenges").delete().eq("nonce", nonce)
      }
    })

    await t.test("N concurrent consumes of ONE nonce → exactly ONE wins (TOCTOU)", async () => {
      const { nonce, hash } = fresh("concurrent")
      try {
        await issue(sb, nonce, hash, new Date(Date.now() + FIVE_MIN).toISOString())
        const N = 10
        const results = await Promise.all(
          Array.from({ length: N }, () => consume(sb, nonce, hash))
        )
        const wins = results.filter((r) => r != null).length
        assert.equal(wins, 1, `exactly one of ${N} concurrent consumes must win, got ${wins}`)
      } finally {
        await sb.from("payout_challenges").delete().eq("nonce", nonce)
      }
    })

    await t.test("an expired challenge consumes to null", async () => {
      const { nonce, hash } = fresh("expired")
      try {
        await issue(sb, nonce, hash, new Date(Date.now() - 1000).toISOString())
        assert.equal(await consume(sb, nonce, hash), null, "an expired nonce must not consume")
      } finally {
        await sb.from("payout_challenges").delete().eq("nonce", nonce)
      }
    })

    await t.test("a challenge issued for a different wallet consumes to null", async () => {
      const { nonce, hash } = fresh("wrong-wallet")
      try {
        await issue(sb, nonce, hash, new Date(Date.now() + FIVE_MIN).toISOString())
        assert.equal(
          await consume(sb, nonce, `${hash}-someone-else`),
          null,
          "a nonce bound to another wallet_hash must not consume"
        )
        // The rightful wallet can still consume it (the wrong-wallet attempt was a no-op).
        assert.notEqual(await consume(sb, nonce, hash), null, "the bound wallet must still consume")
      } finally {
        await sb.from("payout_challenges").delete().eq("nonce", nonce)
      }
    })
  }
)
