// Unit tests for the credit-augmented entitlement DECISION in the payout gate.
// Pure logic, injected fakes — no Supabase, no TronWeb, no network. Run with:
//   npm test
//
// These prove the §3 model: on-chain subscription OR referral credit entitles a
// wallet (both → mode "subscription", unlimited, quota untouched); credit is only
// consumed when the chain is DEFINITIVELY inactive; an already-running credit month
// rescues an unverifiable chain read; and the free-tier path is reached only when
// there is neither a subscription nor credit. The atomic credit SQL itself is proven
// against a real DB in claim.integration.test.ts + credit.toctou.integration.test.ts.

import { test } from "node:test"
import assert from "node:assert/strict"

import { authorizePayout, type AuthzDeps } from "../../src/lib/freeTier/gate.ts"

const PAYER = "TPayerWalletAddrPlaceholder000000000"
const R1 = ["TRecipientAddrOne00000000000000000000"]
const R2 = [
  "TRecipientAddrOne00000000000000000000",
  "TRecipientAddrTwo00000000000000000000",
]

type CreditOpts = { allowActivation: boolean }

/** Deps with spies. `subscribed` is the on-chain read (bool|null); `creditEntitled`
 *  is what the (optional) credit dep returns; `quotaConsumed` drives the free path. */
function makeDeps(opts: {
  subscribed?: boolean | null
  creditEntitled?: boolean
  withCredit?: boolean // default true; false omits the dep (free-tier-only shape)
  quotaConsumed?: boolean
}) {
  const creditCalls: CreditOpts[] = []
  let consumeCalls = 0

  const deps: AuthzDeps = {
    async screen() {
      return []
    },
    async isSubscribed() {
      return opts.subscribed === undefined ? false : opts.subscribed
    },
    async consumeQuota() {
      consumeCalls++
      const consumed = opts.quotaConsumed !== false
      return {
        consumed,
        at: consumed
          ? new Date().toISOString()
          : new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      }
    },
  }
  if (opts.withCredit !== false) {
    deps.checkCredit = async (_addr, o) => {
      creditCalls.push(o)
      return { entitled: opts.creditEntitled === true }
    }
  }
  return {
    deps,
    creditCalls,
    get consumeCalls() {
      return consumeCalls
    },
  }
}

test("on-chain active → subscription; credit is left banked (never checked)", async () => {
  const spy = makeDeps({ subscribed: true, creditEntitled: true })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R2 }, spy.deps)
  assert.deepEqual(res, { ok: true, mode: "subscription" })
  assert.equal(spy.creditCalls.length, 0, "credit must NOT be touched while on-chain active")
})

test("expired + credit entitled → subscription; activation allowed", async () => {
  const spy = makeDeps({ subscribed: false, creditEntitled: true })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R2 }, spy.deps)
  assert.deepEqual(res, { ok: true, mode: "subscription" })
  assert.equal(spy.creditCalls.length, 1)
  assert.equal(
    spy.creditCalls[0].allowActivation,
    true,
    "a DEFINITIVELY inactive chain lets a banked month activate"
  )
})

test("expired + no credit, count 1 → free tier (quota consumed)", async () => {
  const spy = makeDeps({ subscribed: false, creditEntitled: false, quotaConsumed: true })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, spy.deps)
  assert.equal(res.ok, true)
  assert.equal(res.ok === true && res.mode, "free")
  assert.equal(spy.consumeCalls, 1)
})

test("expired + no credit, count > 1 → batch limit", async () => {
  const spy = makeDeps({ subscribed: false, creditEntitled: false })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R2 }, spy.deps)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, "FREE_TIER_BATCH_LIMIT")
})

test("unverifiable + credit entitled → subscription (rescued); activation NOT allowed", async () => {
  const spy = makeDeps({ subscribed: null, creditEntitled: true })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R2 }, spy.deps)
  assert.deepEqual(res, { ok: true, mode: "subscription" })
  assert.equal(spy.creditCalls.length, 1)
  assert.equal(
    spy.creditCalls[0].allowActivation,
    false,
    "an UNVERIFIABLE chain must never burn a banked month — only honor a running one"
  )
})

test("unverifiable + no credit → fail closed (SUBSCRIPTION_UNVERIFIABLE), quota untouched", async () => {
  const spy = makeDeps({ subscribed: null, creditEntitled: false })
  const res = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, spy.deps)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, "SUBSCRIPTION_UNVERIFIABLE")
  assert.equal(spy.consumeCalls, 0, "must never consume the free slot on an unverifiable read")
})

test("no credit dep (free-tier-only shape) → behaves exactly as before", async () => {
  // The existing free-tier gate.test.ts injects no checkCredit; this asserts that
  // shape is unchanged: subscribed=false, count 1 → free; null → unverifiable.
  const free = makeDeps({ subscribed: false, withCredit: false, quotaConsumed: true })
  const r1 = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, free.deps)
  assert.equal(r1.ok === true && r1.mode, "free")

  const unv = makeDeps({ subscribed: null, withCredit: false })
  const r2 = await authorizePayout({ payerAddress: PAYER, recipientAddresses: R1 }, unv.deps)
  assert.equal(r2.ok === false && r2.code, "SUBSCRIPTION_UNVERIFIABLE")
})
