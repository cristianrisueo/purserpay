// INTEGRATION test — the ordered claim gates + the lazy credit consume, against a
// REAL Postgres. The claim/idempotency logic lives in the SQL RPC (for atomicity),
// so — exactly like the free-tier's consume_free_tier — it is proven here against a
// real DB, not mirrored in TS.
//
// Needs:
//   * env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   * the 0003_referrals migration applied to that database.
//
// Auto-SKIPS when the env is absent, so `npm test` never fails without a DB. To run:
//   node --env-file=.env.local --test --experimental-strip-types \
//     "tests/referral/claim.integration.test.ts"
//
// Uses throwaway wallet_hash / code / txid values and cleans them up afterward.

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

/** Unique throwaway ids per run so parallel runs never collide. */
function uid(tag: string): string {
  return `reftest-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

type SB = ReturnType<typeof client>

async function putAccount(
  sb: SB,
  a: {
    hash: string
    code: string
    firstPaid?: boolean
    balance?: number
    activeUntilMs?: number | null
  }
) {
  const { error } = await sb.from("referral_accounts").insert({
    wallet_hash: a.hash,
    referral_code: a.code,
    first_paid_at: a.firstPaid ? new Date().toISOString() : null,
    credit_balance_months: a.balance ?? 0,
    credit_active_until: a.activeUntilMs != null ? new Date(a.activeUntilMs).toISOString() : null,
  })
  if (error) throw new Error(`putAccount: ${error.message}`)
}

async function claim(
  sb: SB,
  txid: string,
  refereeHash: string,
  referrerCode: string | null,
  grant = true
): Promise<{ granted: boolean; reason: string }> {
  const { data, error } = await sb.rpc("claim_referral_reward", {
    p_txid: txid,
    p_referee_hash: refereeHash,
    p_referrer_code: referrerCode,
    p_grant: grant,
  })
  if (error) throw new Error(`claim_referral_reward: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { granted: row?.granted === true, reason: String(row?.reason ?? "") }
}

async function consumeCredit(
  sb: SB,
  hash: string,
  allowActivation: boolean
): Promise<{ entitled: boolean; activeUntil: string | null }> {
  const { data, error } = await sb.rpc("consume_referral_credit", {
    p_wallet_hash: hash,
    p_allow_activation: allowActivation,
  })
  if (error) throw new Error(`consume_referral_credit: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { entitled: row?.entitled === true, activeUntil: row?.active_until ?? null }
}

async function balanceOf(sb: SB, hash: string): Promise<number> {
  const { data } = await sb
    .from("referral_accounts")
    .select("credit_balance_months")
    .eq("wallet_hash", hash)
    .maybeSingle()
  return data?.credit_balance_months ?? -1
}

async function cleanup(sb: SB, hashes: string[], txids: string[]) {
  for (const t of txids) await sb.from("referral_rewards").delete().eq("txid", t)
  // Rewards reference accounts; also clear any reward rows pointing at these hashes.
  for (const h of hashes) {
    await sb.from("referral_rewards").delete().eq("referee_wallet_hash", h)
    await sb.from("referral_rewards").delete().eq("referrer_wallet_hash", h)
  }
  // Break the referred_by_code self-FK before deleting accounts.
  for (const h of hashes) {
    await sb.from("referral_accounts").update({ referred_by_code: null }).eq("wallet_hash", h)
  }
  for (const h of hashes) await sb.from("referral_accounts").delete().eq("wallet_hash", h)
}

test(
  "referral claim gates + lazy credit consume (real Postgres)",
  { skip: hasEnv ? false : "set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run" },
  async (t) => {
    const sb = client()

    await t.test("self-referral → no grant", async () => {
      const hx = uid("self-h")
      const cx = uid("self-c")
      try {
        await putAccount(sb, { hash: hx, code: cx, firstPaid: false })
        const r = await claim(sb, uid("self-tx"), hx, cx, true)
        assert.equal(r.granted, false)
        assert.equal(r.reason, "self_referral")
      } finally {
        await cleanup(sb, [hx], [])
      }
    })

    await t.test("referrer entitled via CREDIT ONLY → grant succeeds (Active-Lock fix)", async () => {
      const hr = uid("credit-r-h")
      const cr = uid("credit-r-c")
      const he = uid("credit-e-h")
      const ce = uid("credit-e-c")
      const tx = uid("credit-tx")
      try {
        // Referrer: never paid on-chain, but a credit month is running -> entitled.
        await putAccount(sb, { hash: hr, code: cr, firstPaid: false, balance: 0, activeUntilMs: Date.now() + 10 * DAY_MS })
        await putAccount(sb, { hash: he, code: ce, firstPaid: false })
        const r = await claim(sb, tx, he, cr, true)
        assert.equal(r.granted, true, `expected grant, got ${r.reason}`)
        assert.equal(await balanceOf(sb, hr), 1, "referrer banks exactly one month")
      } finally {
        await cleanup(sb, [hr, he], [tx])
      }
    })

    await t.test("referrer NOT entitled (never paid, no credit) → no grant", async () => {
      const hr = uid("none-r-h")
      const cr = uid("none-r-c")
      const he = uid("none-e-h")
      const ce = uid("none-e-c")
      const tx = uid("none-tx")
      try {
        await putAccount(sb, { hash: hr, code: cr, firstPaid: false, balance: 0, activeUntilMs: null })
        await putAccount(sb, { hash: he, code: ce, firstPaid: false })
        const r = await claim(sb, tx, he, cr, true)
        assert.equal(r.granted, false)
        assert.equal(r.reason, "referrer_not_entitled")
        assert.equal(await balanceOf(sb, hr), 0)
      } finally {
        await cleanup(sb, [hr, he], [tx])
      }
    })

    await t.test("referee's SECOND paid month → no grant", async () => {
      const hr = uid("second-r-h")
      const cr = uid("second-r-c")
      const he = uid("second-e-h")
      const ce = uid("second-e-c")
      const tx = uid("second-tx")
      try {
        await putAccount(sb, { hash: hr, code: cr, firstPaid: true }) // entitled referrer
        await putAccount(sb, { hash: he, code: ce, firstPaid: true }) // already paid before
        const r = await claim(sb, tx, he, cr, true)
        assert.equal(r.granted, false)
        assert.equal(r.reason, "not_first_payment")
        assert.equal(await balanceOf(sb, hr), 0)
      } finally {
        await cleanup(sb, [hr, he], [tx])
      }
    })

    await t.test("idempotent: one reward per referee, ever", async () => {
      const hr = uid("idem-r-h")
      const cr = uid("idem-r-c")
      const he = uid("idem-e-h")
      const ce = uid("idem-e-c")
      const txA = uid("idem-txA")
      const txB = uid("idem-txB")
      try {
        await putAccount(sb, { hash: hr, code: cr, firstPaid: true })
        await putAccount(sb, { hash: he, code: ce, firstPaid: false })

        const first = await claim(sb, txA, he, cr, true)
        assert.equal(first.granted, true, `first claim should grant, got ${first.reason}`)
        assert.equal(await balanceOf(sb, hr), 1)

        // Same txid again → the first-payment gate blocks it (no double grant).
        const again = await claim(sb, txA, he, cr, true)
        assert.equal(again.granted, false)
        assert.equal(await balanceOf(sb, hr), 1, "no double grant on a repeat claim")

        // Even if first_paid_at were somehow cleared, the referee-UNIQUE reward guard
        // still caps it at one, on a fresh txid → already_granted.
        await sb.from("referral_accounts").update({ first_paid_at: null }).eq("wallet_hash", he)
        const third = await claim(sb, txB, he, cr, true)
        assert.equal(third.granted, false)
        assert.equal(third.reason, "already_granted")
        assert.equal(await balanceOf(sb, hr), 1, "referee can only ever earn ONE reward")
      } finally {
        await cleanup(sb, [hr, he], [txA, txB])
      }
    })

    await t.test("credit consume: activate, honor-without-decrement, and null never burns", async () => {
      const h = uid("consume-h")
      const c = uid("consume-c")
      try {
        // Balance 3, nothing running.
        await putAccount(sb, { hash: h, code: c, balance: 3, activeUntilMs: null })

        // Activate one month → entitled, balance 3 → 2, a window opens.
        const a1 = await consumeCredit(sb, h, true)
        assert.equal(a1.entitled, true)
        assert.notEqual(a1.activeUntil, null)
        assert.equal(await balanceOf(sb, h), 2)

        // A month is now running → entitled WITHOUT decrement.
        const a2 = await consumeCredit(sb, h, true)
        assert.equal(a2.entitled, true)
        assert.equal(await balanceOf(sb, h), 2, "a running month is honored, never re-charged")

        // Expire the window, keep balance 2. An UNVERIFIABLE read (allowActivation=false)
        // must NOT burn a banked month.
        await sb.from("referral_accounts").update({ credit_active_until: null }).eq("wallet_hash", h)
        const a3 = await consumeCredit(sb, h, false)
        assert.equal(a3.entitled, false, "no running month + activation disallowed → not entitled")
        assert.equal(await balanceOf(sb, h), 2, "an unverifiable chain read never consumes credit")

        // A definitively-inactive read (allowActivation=true) activates → balance 2 → 1.
        const a4 = await consumeCredit(sb, h, true)
        assert.equal(a4.entitled, true)
        assert.equal(await balanceOf(sb, h), 1)
      } finally {
        await cleanup(sb, [h], [])
      }
    })
  }
)
