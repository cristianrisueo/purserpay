// INTEGRATION test — prove the lazy credit consume is atomic under concurrency
// (TOCTOU), against a REAL Postgres. N concurrent gate checks on a wallet with
// balance 1 must consume EXACTLY ONE month (balance 1 → 0, never negative, never
// two decrements), while every caller still comes away entitled.
//
// Needs:
//   * env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   * the 0003_referrals migration applied to that database.
//
// Auto-SKIPS when the env is absent. To run:
//   node --env-file=.env.local --test --experimental-strip-types \
//     "tests/referral/credit.toctou.integration.test.ts"

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

function uid(tag: string): string {
  return `credit-toctou-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

type SB = ReturnType<typeof client>

async function consume(sb: SB, hash: string): Promise<{ entitled: boolean }> {
  const { data, error } = await sb.rpc("consume_referral_credit", {
    p_wallet_hash: hash,
    p_allow_activation: true,
  })
  if (error) throw new Error(`consume_referral_credit: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { entitled: row?.entitled === true }
}

async function balanceOf(sb: SB, hash: string): Promise<number> {
  const { data } = await sb
    .from("referral_accounts")
    .select("credit_balance_months")
    .eq("wallet_hash", hash)
    .maybeSingle()
  return data?.credit_balance_months ?? -1
}

test(
  "credit consume is atomic under concurrency (real Postgres)",
  { skip: hasEnv ? false : "set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run" },
  async () => {
    const sb = client()
    const hash = uid("bal1")
    const code = uid("code")
    try {
      // One banked month, nothing running.
      const { error } = await sb.from("referral_accounts").insert({
        wallet_hash: hash,
        referral_code: code,
        credit_balance_months: 1,
        credit_active_until: null,
      })
      if (error) throw new Error(`insert: ${error.message}`)

      const N = 12
      const results = await Promise.all(Array.from({ length: N }, () => consume(sb, hash)))

      // Every concurrent caller comes away entitled (the winner activates the month;
      // the rest honor the now-running window).
      assert.equal(
        results.filter((r) => r.entitled).length,
        N,
        "every concurrent caller must end up entitled"
      )

      // But EXACTLY ONE month was consumed: balance 1 → 0, never negative, never two.
      assert.equal(
        await balanceOf(sb, hash),
        0,
        "exactly one of the concurrent consumes may decrement the balance"
      )
    } finally {
      await sb.from("referral_accounts").delete().eq("wallet_hash", hash)
    }
  }
)
