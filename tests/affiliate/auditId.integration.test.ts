// INTEGRATION test — prove the Node auditId() mirror equals the SQL `audit_id`
// GENERATED STORED column (0006), against a REAL Postgres. If the two ever drift,
// a PDF's Audit ID would not match what /verify looks up. It talks to Supabase
// directly (service role), so it needs:
//   * env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   * migrations 0005 + 0006 applied to that database.
//
// Auto-SKIPS when env is absent, so `npm test` never fails on a machine without a DB.
// To run it (LOCAL only):
//   node --env-file=.env.local --test --experimental-strip-types \
//     "tests/affiliate/auditId.integration.test.ts"

import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

import { auditId } from "../../src/lib/affiliate/auditId.ts"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && serviceKey)

test(
  "Node auditId() equals the SQL generated column (real Postgres)",
  { skip: hasEnv ? false : "set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run" },
  async () => {
    const sb = createClient(url as string, serviceKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const txid = `audit-int-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    const hash = `recip-int-${Math.floor(Math.random() * 1e9)}`
    try {
      const rec = await sb.rpc("record_disperse_receipts", {
        p_txid: txid,
        p_payer: "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2",
        p_network: "nile",
        p_block_ts: null,
        p_recipient_hashes: [hash],
        p_amounts: ["1000000"],
      })
      assert.equal(rec.error, null, rec.error?.message)

      const { data, error } = await sb.rpc("receipt_detail", {
        p_txid: txid,
        p_recipient_wallet_hash: hash,
      })
      assert.equal(error, null, error?.message)
      const row = Array.isArray(data) ? data[0] : data
      assert.ok(row, "receipt_detail returned a row")
      assert.equal(row.audit_id, auditId(txid, hash))
    } finally {
      await sb.from("disperse_receipts").delete().eq("txid", txid)
    }
  }
)
