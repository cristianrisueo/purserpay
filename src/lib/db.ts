import Dexie, { type EntityTable } from "dexie"

import { dropRoleField } from "@/lib/dbMigrations"

// The roster's only home. Names/addresses/amounts live here, in the client's
// own IndexedDB, and nowhere else — never localStorage, never a server call.
export type StoredPayee = {
  id: string
  /** Date.now()-based sort key. A UUID primary key doesn't iterate in
   *  insertion order, so row order needs its own indexed field. */
  order: number
  name: string
  address: string
  amount: number
}

// A confirmed on-chain payout batch — the local receipt behind a green row.
// Stored client-side only (same promise as the roster: nothing on a server).
// This is what makes "paid" survive a reload and blocks accidental re-payment,
// and what Sprint 3D's PDF receipts will read.
export type StoredPayment = {
  id: string
  /** On-chain transaction hash of the disperse. */
  txid: string
  /** Network key (e.g. "nile") — a receipt on one network never greens another. */
  network: string
  /** Date.now() at confirmation. */
  timestamp: number
  /** Roster ids paid in this batch (drives the green state). */
  payeeIds: string[]
  /** Snapshot of who got exactly what, for the receipt. */
  recipients: { id: string; address: string; amount: number }[]
  /** Batch total in USDT base units (stringified bigint). */
  totalBaseUnits: string
}

// Small client-side key/value store. Holds the "green cycle" boundary
// (greenSince): receipts stay forever (Sprint 3D reads them), but a payout is
// monthly — Reset advances greenSince so the same roster can be paid again next
// cycle without deleting history and without ever re-paying the current one.
export type StoredMeta = { key: string; value: number }

export const db = new Dexie("purserpay") as Dexie & {
  payees: EntityTable<StoredPayee, "id">
  payments: EntityTable<StoredPayment, "id">
  meta: EntityTable<StoredMeta, "key">
}

// v1: roster only. v2 ADDS the payments + meta stores — additive, so existing
// rosters are preserved untouched on upgrade.
db.version(1).stores({
  payees: "id, order",
})
db.version(2).stores({
  payees: "id, order",
  payments: "id, txid, timestamp, *payeeIds",
  meta: "key",
})
// v3 (ROLE-1): the payee `role` field is retired. No index changed (role was never
// indexed), so this is a data-cleanup upgrade — it strips the now-dead `role` bytes
// from every existing stored payee WITHOUT wiping the roster: name/address/amount all
// survive. New DBs start here clean; upgraded ones lose only `role`.
db.version(3)
  .stores({
    payees: "id, order",
    payments: "id, txid, timestamp, *payeeIds",
    meta: "key",
  })
  .upgrade((tx) => tx.table("payees").toCollection().modify(dropRoleField))

if (process.env.NODE_ENV !== "production") {
  // Lets devtools/testing seed or inspect the roster directly, without a
  // user-facing "load sample data" feature that would inject fake rows into
  // what's now the user's real, private data.
  ;(window as unknown as { __purserDb: typeof db }).__purserDb = db
}
