// One source of truth for what "duplicate address" means in a roster, shared by
// the manual add/edit guard (roster.ts) and the CSV importer (csvImport.ts) so
// both paths agree exactly. A duplicate is the SAME TRON base58 string appearing
// more than once, matched CASE-SENSITIVELY: TRON base58 is case-sensitive, so two
// addresses differing only in case are DIFFERENT wallets and must never be
// collapsed. The rule everywhere is RETAIN, never DISCARD — a duplicate is never
// silently auto-removed; the user decides which row is valid.
//
// Why this matters: the atomic disperse batch is built straight from the roster,
// so the same wallet twice = paying one person twice in a single signature — a
// silent double-payment of real money. Guaranteeing unique addresses at insertion
// closes that gap.
//
// Pure and dependency-free (no DB, no I/O, no imports) — so it is directly
// unit-testable under `node --test`, whose ESM loader can't resolve the repo's
// extensionless relative imports.

export type AddressConflict = {
  /** The base58 string shared by every row in `indices`. */
  address: string
  /** Indices (into the scanned array) of the rows that share `address`. */
  indices: number[]
}

/** Every group of rows sharing one identical address, each with the input
 *  indices that collide. `[]` when all addresses are unique. Single pass over a
 *  reverse index (mirrors `describeMappingCollision`); group order follows first
 *  appearance, so downstream messages are deterministic. */
export function findDuplicateAddresses(
  rows: readonly { address: string }[]
): AddressConflict[] {
  const byAddress = new Map<string, number[]>()
  rows.forEach((row, i) => {
    const list = byAddress.get(row.address)
    if (list) list.push(i)
    else byAddress.set(row.address, [i])
  })

  const conflicts: AddressConflict[] = []
  for (const [address, indices] of byAddress) {
    if (indices.length > 1) conflicts.push({ address, indices })
  }
  return conflicts
}

/** The first existing row whose address exactly matches `address`, skipping the
 *  row identified by `excludeId` (the row being edited — so re-saving a payee
 *  with its own unchanged address is allowed). Same case-sensitive exact-match
 *  semantics as `findDuplicateAddresses`. Used by the manual add/edit guard to
 *  name the row a new/edited address would collide with. */
export function findAddressOwner<T extends { id: string; address: string }>(
  rows: readonly T[],
  address: string,
  excludeId?: string
): T | undefined {
  return rows.find((r) => r.address === address && r.id !== excludeId)
}

export type DedupeSplit = {
  /** Input indices safe to import — each address is unique in the scanned set. */
  uniqueIndices: number[]
  /** One human message per conflicting address group (empty when none). */
  conflicts: string[]
}

/** Splits a row list into the addresses safe to import and human messages for
 *  the ones held back. RETENTION, not discard: EVERY row in a conflict group is
 *  held back — none is imported — so a duplicate never silently picks a winner;
 *  the user resolves it and re-adds. `rowNumber(i)` maps an input index to the
 *  number shown to the user (for the CSV path, `i => i + 2`: header row + 1-based). */
export function splitByAddress(
  rows: readonly { address: string }[],
  rowNumber: (i: number) => number
): DedupeSplit {
  const groups = findDuplicateAddresses(rows)

  const held = new Set<number>()
  for (const group of groups) {
    for (const i of group.indices) held.add(i)
  }

  const uniqueIndices: number[] = []
  rows.forEach((_, i) => {
    if (!held.has(i)) uniqueIndices.push(i)
  })

  const conflicts = groups.map((group) => formatConflict(group, rowNumber))
  return { uniqueIndices, conflicts }
}

/** "Rows 4 and 12 share the same address (T1abc…wxyz). …" — the "and" / ", … and"
 *  grammar matches `describeMappingCollision` (a conflict group always has ≥2
 *  rows). */
function formatConflict(
  group: AddressConflict,
  rowNumber: (i: number) => number
): string {
  const nums = group.indices.map(rowNumber)
  const joined =
    nums.length === 2
      ? `${nums[0]} and ${nums[1]}`
      : `${nums.slice(0, -1).join(", ")}, and ${nums[nums.length - 1]}`
  return `Rows ${joined} share the same address (${truncateForDisplay(group.address)}). Each payee needs a unique address. These rows were NOT imported — resolve them and re-add.`
}

/** Middle-ellipsis for display only — mirrors `truncateAddress` in ./format
 *  (lead 6, tail 5). Inlined so this module stays dependency-free and directly
 *  node-testable; the full address never appears in a user-facing message. */
function truncateForDisplay(address: string, lead = 6, tail = 5): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}
