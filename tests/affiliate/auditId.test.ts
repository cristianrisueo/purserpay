// The Audit ID (Sprint 1B) must be DETERMINISTIC and STABLE — the same receipt
// always yields the same ID across regenerations — and match a fixed format. The
// canonical formula lives in the SQL generated column (0006); this proves the Node
// mirror (src/lib/affiliate/auditId.ts) is stable and correctly shaped. The pinned
// vector is cross-checked against the real generated column (see the DB probe in the
// sprint report and auditId.integration.test.ts). No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import { auditId, AUDIT_ID_PREFIX } from "../../src/lib/affiliate/auditId.ts"

test("deterministic — same (txid, recipient hash) yields the same id", () => {
  assert.equal(auditId("txabc", "hash123"), auditId("txabc", "hash123"))
})

test("format — PP- followed by exactly 16 uppercase hex chars", () => {
  const id = auditId("deadbeef", "recip")
  assert.match(id, /^PP-[0-9A-F]{16}$/)
  assert.ok(id.startsWith(AUDIT_ID_PREFIX))
})

test("distinct receipts -> distinct ids (txid OR recipient changes it)", () => {
  const base = auditId("tx1", "r1")
  assert.notEqual(base, auditId("tx2", "r1"))
  assert.notEqual(base, auditId("tx1", "r2"))
})

test("pinned vector — guards the exact formula against drift", () => {
  // sha256("<txid>:<recipient_wallet_hash>") first 16 hex, uppercased. This exact
  // value was produced BOTH by this function and by the SQL `audit_id` generated
  // column for the same inputs (0006_receipt_audit.sql) — so if either side changes
  // its formula, this pin breaks.
  assert.equal(
    auditId("probe_tx_" + "deadbeef".repeat(4), "recip_hash_probe_0006_abc123"),
    "PP-B74B152F1CB34482"
  )
})
