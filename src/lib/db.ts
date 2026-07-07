import Dexie, { type EntityTable } from "dexie"

// The roster's only home. Names/addresses/amounts live here, in the client's
// own IndexedDB, and nowhere else — never localStorage, never a server call.
export type StoredPayee = {
  id: string
  /** Date.now()-based sort key. A UUID primary key doesn't iterate in
   *  insertion order, so row order needs its own indexed field. */
  order: number
  name: string
  role: string
  address: string
  amount: number
}

export const db = new Dexie("purserpay") as Dexie & {
  payees: EntityTable<StoredPayee, "id">
}

db.version(1).stores({
  payees: "id, order",
})

if (import.meta.env.DEV) {
  // Lets devtools/testing seed or inspect the roster directly, without a
  // user-facing "load sample data" feature that would inject fake rows into
  // what's now the user's real, private data.
  ;(window as unknown as { __purserDb: typeof db }).__purserDb = db
}
