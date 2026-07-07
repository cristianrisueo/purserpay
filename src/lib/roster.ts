import { db, type StoredPayee } from "@/lib/db"
import { validatePayeeShape, type PayeeInput } from "@/lib/payeeValidation"

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
  await db.payees.add({ ...value, id: crypto.randomUUID(), order: Date.now() })
}

export async function updatePayee(id: string, input: PayeeInput): Promise<void> {
  const value = requireValid(input)
  await db.payees.update(id, value)
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
