// Unit tests for ensureAllowance — the USDT-TRC20 allowance dance that makes the
// mainnet approve(allowance == 0 || value == 0) rule safe. No wallet, no network:
// the on-chain primitives (approve, confirm) are injected, so all three branches —
// and crucially the tx ORDER of the reset case — are asserted with plain fakes.
//
// Run with:  npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import { ensureAllowance, type AllowanceDeps } from "../../src/lib/tron/allowance.ts"

const SPENDER = "TSpenderContract"

/** Records the exact sequence of on-chain steps and lifecycle events so a test can
 *  assert both WHICH approves happened and in WHAT order relative to confirms. */
function recorder() {
  const steps: string[] = [] // e.g. "approve:0", "confirm:tx0", "approve:1500", "confirm:tx1"
  const approves: Array<{ spender: string; value: bigint }> = []
  const events: string[] = []
  let n = 0
  const deps: AllowanceDeps = {
    approve: async (spender, value) => {
      approves.push({ spender, value })
      steps.push(`approve:${value}`)
      return `tx${n++}`
    },
    confirm: async (txid) => {
      steps.push(`confirm:${txid}`)
    },
  }
  const eventsObj = {
    onApproveStart: () => events.push("start"),
    onApproveReset: () => events.push("reset"),
  }
  return { deps, eventsObj, steps, approves, events }
}

// --- Branch 1: allowance already sufficient → no tx, no prompt ----------------

test("sufficient allowance: no approve, no events, empty result", async () => {
  const r = recorder()
  const res = await ensureAllowance(2000n, 1500n, SPENDER, r.deps, r.eventsObj)

  assert.deepEqual(res, {})
  assert.equal(r.approves.length, 0, "no approve was sent")
  assert.deepEqual(r.events, [], "no lifecycle events fired")
})

test("sufficient at the exact boundary (current === needed): no tx", async () => {
  const r = recorder()
  const res = await ensureAllowance(1500n, 1500n, SPENDER, r.deps, r.eventsObj)
  assert.deepEqual(res, {})
  assert.equal(r.approves.length, 0)
})

// --- Branch 2: zero allowance → a single approve(needed) ----------------------

test("zero allowance: single approve(needed), onApproveStart only", async () => {
  const r = recorder()
  const res = await ensureAllowance(0n, 1500n, SPENDER, r.deps, r.eventsObj)

  assert.equal(r.approves.length, 1, "exactly one approve")
  assert.deepEqual(r.approves[0], { spender: SPENDER, value: 1500n })
  assert.deepEqual(r.steps, ["approve:1500", "confirm:tx0"], "approve then confirm")
  assert.deepEqual(r.events, ["start"], "no reset on the zero path")
  assert.deepEqual(res, { approveTxid: "tx0" })
})

// --- Branch 3: non-zero but short → reset to 0 FIRST, then approve(needed) -----

test("non-zero short allowance: resets to 0 BEFORE approving needed (order asserted)", async () => {
  const r = recorder()
  const res = await ensureAllowance(150n, 1500n, SPENDER, r.deps, r.eventsObj)

  // Two approves, in strict order: clear to 0, then set the needed amount.
  assert.equal(r.approves.length, 2, "exactly two approves")
  assert.deepEqual(r.approves[0], { spender: SPENDER, value: 0n }, "1st approve clears to 0")
  assert.deepEqual(r.approves[1], { spender: SPENDER, value: 1500n }, "2nd approve sets needed")

  // The reset is CONFIRMED before the second approve is even requested — the token
  // must never see a non-zero → non-zero approve.
  assert.deepEqual(
    r.steps,
    ["approve:0", "confirm:tx0", "approve:1500", "confirm:tx1"],
    "reset confirmed before the second approve"
  )

  // The user is warned (reset) before the "approving" step.
  assert.deepEqual(r.events, ["reset", "start"], "reset announced before approving")

  assert.deepEqual(res, { resetTxid: "tx0", approveTxid: "tx1" })
})

test("reset path surfaces a resetTxid distinct from the approveTxid", async () => {
  const r = recorder()
  const res = await ensureAllowance(1n, 1500n, SPENDER, r.deps, r.eventsObj)
  assert.equal(res.resetTxid, "tx0")
  assert.equal(res.approveTxid, "tx1")
  assert.notEqual(res.resetTxid, res.approveTxid)
})

// --- Failure propagation: a failing reset aborts before the second approve ----

test("a reset that fails to confirm aborts before the second approve", async () => {
  const approves: bigint[] = []
  let n = 0
  const deps: AllowanceDeps = {
    approve: async (_spender, value) => {
      approves.push(value)
      return `tx${n++}`
    },
    confirm: async (txid) => {
      if (txid === "tx0") throw new Error("reset reverted")
    },
  }
  await assert.rejects(
    () => ensureAllowance(150n, 1500n, SPENDER, deps),
    /reset reverted/
  )
  // Only the reset approve was attempted; the needed approve never fired.
  assert.deepEqual(approves, [0n], "second approve was never sent after a failed reset")
})
