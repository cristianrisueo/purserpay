// Sprint ROLE-1 — the Dexie v3 upgrade that retires the payee `role` field. The ONE
// real risk of removing a field is wiping the user's existing device-local roster on
// upgrade. `role` was never a Dexie index, so existing payees survive the type change
// regardless; the v3 .upgrade() only strips the now-dead `role` bytes. This proves that
// strip is lossless — name/address/amount/id/order all survive. Pure transform, no DB,
// no `@/` (db.ts pulls in dexie + window; the transform is isolated in dbMigrations.ts).
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import { dropRoleField } from "../../src/lib/dbMigrations.ts"

const A = "TAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"

test("dropRoleField: strips role, preserves id/order/name/address/amount (NO data loss)", () => {
  const row: Record<string, unknown> = {
    id: "x",
    order: 5,
    name: "Priya",
    role: "Editor",
    address: A,
    amount: 1000,
  }
  dropRoleField(row)
  assert.equal("role" in row, false)
  // Everything that matters for a payout survives, byte-for-byte.
  assert.deepEqual(row, { id: "x", order: 5, name: "Priya", address: A, amount: 1000 })
})

test("dropRoleField: a row that never had a role is left untouched (idempotent)", () => {
  const row: Record<string, unknown> = { id: "y", order: 9, name: "Sam", address: A, amount: 42 }
  dropRoleField(row)
  assert.deepEqual(row, { id: "y", order: 9, name: "Sam", address: A, amount: 42 })
})

test("dropRoleField: an empty-string role is still removed (not just falsy-skipped)", () => {
  const row: Record<string, unknown> = { id: "z", order: 1, name: "Bo", role: "", address: A, amount: 7 }
  dropRoleField(row)
  assert.equal("role" in row, false)
})
