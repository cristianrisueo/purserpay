import { db, type StoredPayee } from "@/lib/db"
import { validatePayeeShape, type PayeeInput } from "@/lib/payeeValidation"
import { findAddressOwner, findDuplicateAddresses } from "@/lib/rosterDedupe"

export type Payee = {
  id: string
  name: string
  role: string
  address: string
  amount: number
}

export function toPayee(row: StoredPayee): Payee {
  return { id: row.id, name: row.name, role: row.role, address: row.address, amount: row.amount }
}

function requireValid(input: PayeeInput): PayeeInput {
  const result = validatePayeeShape(input)
  if (!result.ok) throw new Error(result.errors.join(" "))
  return result.value
}

export async function addPayee(input: PayeeInput): Promise<void> {
  const value = requireValid(input)
  // Uniqueness guard: the same address twice in the roster = paying one person
  // twice in the atomic batch. Reject with a NAMED error before persisting; the
  // caller surfaces it like any other validation error. RETAIN, never discard —
  // the existing row is left untouched.
  const existing = await db.payees.toArray()
  const owner = findAddressOwner(existing, value.address)
  if (owner) throw new Error(duplicateAddressMessage(owner.name))
  await db.payees.add({ ...value, id: crypto.randomUUID(), order: Date.now() })
}

export async function updatePayee(id: string, input: PayeeInput): Promise<void> {
  const value = requireValid(input)
  // Same guard, excluding the row being edited — so re-saving a payee with its
  // own unchanged address is allowed; colliding with ANOTHER row is rejected.
  const existing = await db.payees.toArray()
  const owner = findAddressOwner(existing, value.address, id)
  if (owner) throw new Error(duplicateAddressMessage(owner.name))
  await db.payees.update(id, value)
}

/** The single named error for a manual add/edit that would duplicate an
 *  address, so both paths read identically. */
function duplicateAddressMessage(existingName: string): string {
  return `You already have a payee with this address (${existingName}). Use a different address or edit the existing one.`
}

export async function removePayee(id: string): Promise<void> {
  await db.payees.delete(id)
}

/** The CSV overwrite path: atomic clear + bulk add. Every row must already be
 *  validated by the caller (applyMapping) — this re-validates as
 *  defense-in-depth. If anything fails, the transaction rolls back and the
 *  existing roster is left completely untouched, never half-written. */
export async function replaceRoster(rows: PayeeInput[]): Promise<void> {
  const values = rows.map(requireValid)
  // Defense-in-depth: the CSV path (applyMapping → splitByAddress) already holds
  // duplicates back, so this never fires in practice — but it makes "the roster
  // stores unique addresses" a data-layer guarantee for ANY caller, not just the
  // one importer. If it ever trips, that's a caller bug, not a silent overwrite.
  if (findDuplicateAddresses(values).length > 0) {
    throw new Error(
      "Refusing to import a roster with duplicate addresses. Each payee needs a unique address."
    )
  }
  const base = Date.now()
  const stored: StoredPayee[] = values.map((v, i) => ({
    ...v,
    id: crypto.randomUUID(),
    order: base + i,
  }))

  await db.transaction("rw", db.payees, async () => {
    await db.payees.clear()
    await db.payees.bulkAdd(stored)
  })
}
