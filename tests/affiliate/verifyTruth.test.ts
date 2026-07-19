// ANTI-PHOTOSHOP (structural): the public verification path must read the amount
// from the CHAIN-DERIVED index, never from client input — that is the whole point of
// /verify (D4). We assert the verify_receipt RPC (0006) reads disperse_receipts,
// takes NO amount parameter, and leaks no recipient hash; and that the /verify page
// passes ONLY (txid, auditId) to it. If someone later lets the page echo a
// query-string amount, this fails. No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8")

test("verify_receipt reads the amount from disperse_receipts and takes NO amount param", () => {
  const migration = read("../../supabase/migrations/0006_receipt_audit.sql")
  const start = migration.indexOf("function public.verify_receipt(")
  assert.ok(start >= 0, "verify_receipt function must exist")

  // Parameter list = between the opening "(" and its first closing ")".
  const paramsEnd = migration.indexOf(")", start)
  const params = migration.slice(start, paramsEnd)
  assert.match(params, /p_txid/)
  assert.match(params, /p_audit_id/)
  assert.doesNotMatch(params, /amount/i, "no amount parameter — cannot echo client input")

  // Body reads the index; the amount is index truth.
  const body = migration.slice(start, migration.indexOf("$$;", start))
  assert.match(body, /from public\.disperse_receipts/i)
  assert.match(body, /amount_base_units/)
  // Never returns the recipient hash — leaks nothing beyond public on-chain facts.
  assert.doesNotMatch(body, /recipient_wallet_hash/)
})

test("the /verify page passes ONLY (txid, auditId) to verifyReceipt", () => {
  const src = read("../../src/app/verify/[txid]/page.tsx")
  assert.match(src, /verifyReceipt\(txid, auditId\)/)
  // The only query input is `a` (the audit id); no amount is read from the request.
  assert.doesNotMatch(src, /searchParams[\s\S]{0,80}amount/i)
})
