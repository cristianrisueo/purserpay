// GRANT-ONLY guarantee (structural): the bounty ledger can NEVER gate or deny an
// affiliate's access to their own receipts. We enforce it by construction — the
// receipts read path (the TS module AND the SQL read RPC) must never reference the
// bounty ledger. If someone later joins affiliate_bounties into the receipts read,
// this test fails. No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8")

test("the receipts read module never references the bounty ledger", () => {
  const src = read("../../src/lib/affiliate/receipts.ts")
  assert.doesNotMatch(src, /affiliate_bount/i)
  assert.doesNotMatch(src, /\bbounty\b/i)
})

test("the affiliate_receipts SQL RPC reads ONLY disperse_receipts, never the ledger", () => {
  const migration = read("../../supabase/migrations/0005_affiliate_portal.sql")
  // Isolate the affiliate_receipts function body (up to its closing $$;).
  const start = migration.indexOf("function public.affiliate_receipts(")
  assert.ok(start >= 0, "affiliate_receipts function must exist")
  const body = migration.slice(start, migration.indexOf("$$;", start))
  assert.match(body, /from public\.disperse_receipts/i)
  assert.doesNotMatch(body, /affiliate_bounties/i)
})

test("the record RPC is idempotent (on conflict do nothing) — never errors a re-record", () => {
  const migration = read("../../supabase/migrations/0005_affiliate_portal.sql")
  const start = migration.indexOf("function public.record_disperse_receipts(")
  assert.ok(start >= 0)
  const body = migration.slice(start, migration.indexOf("$$;", start))
  assert.match(body, /on conflict \(txid, recipient_wallet_hash\) do nothing/i)
})
