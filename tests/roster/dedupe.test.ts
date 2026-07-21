// Sprint S-0 — roster address dedupe. The same TRON address twice in a roster =
// paying one person twice in the atomic disperse — a silent double-payment of real
// money. This is the pure logic that closes that gap, shared by the manual add/edit
// guard (roster.ts) and the CSV importer (csvImport.ts). The rule is RETAIN, never
// discard: a duplicate is held back for the user to resolve, never silently dropped
// or auto-picked. All pure — no DB, no env, no `@/`.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  findAddressOwner,
  findDuplicateAddresses,
  groupAddressConflicts,
  resolveConflictPicks,
  splitByAddress,
  type RowConflictGroup,
} from "../../src/lib/rosterDedupe.ts"

// Two 34-char strings differing ONLY in the case of one character. TRON base58 is
// case-sensitive, so these are DIFFERENT wallets and must never be treated as one.
const MIXED_UPPER = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"
const MIXED_LOWER = "TeSXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"

const A = "TAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"
const B = "TBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2"
const C = "TCccccccccccccccccccccccccccccccc3"

// --- findDuplicateAddresses --------------------------------------------------

test("findDuplicateAddresses: an all-unique set has no conflicts", () => {
  assert.deepEqual(findDuplicateAddresses([{ address: A }, { address: B }, { address: C }]), [])
})

test("findDuplicateAddresses: a 2-way collision groups both indices", () => {
  const groups = findDuplicateAddresses([{ address: A }, { address: B }, { address: A }])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].address, A)
  assert.deepEqual(groups[0].indices, [0, 2])
})

test("findDuplicateAddresses: a 3-way collision is one group of three", () => {
  const groups = findDuplicateAddresses([
    { address: A },
    { address: A },
    { address: B },
    { address: A },
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].indices, [0, 1, 3])
})

test("findDuplicateAddresses: two independent collisions are two groups", () => {
  const groups = findDuplicateAddresses([
    { address: A },
    { address: B },
    { address: A },
    { address: B },
  ])
  assert.equal(groups.length, 2)
})

test("findDuplicateAddresses: case-only difference is NOT a duplicate", () => {
  assert.deepEqual(
    findDuplicateAddresses([{ address: MIXED_UPPER }, { address: MIXED_LOWER }]),
    []
  )
})

// --- findAddressOwner (manual add/edit) --------------------------------------

test("findAddressOwner: finds an existing row with the same address", () => {
  const rows = [{ id: "1", address: A }, { id: "2", address: B }]
  assert.equal(findAddressOwner(rows, A)?.id, "1")
})

test("findAddressOwner: excludeId lets a row keep its OWN address (edit is allowed)", () => {
  const rows = [{ id: "1", address: A }]
  assert.equal(findAddressOwner(rows, A, "1"), undefined)
})

test("findAddressOwner: editing onto ANOTHER row's address still collides", () => {
  const rows = [{ id: "1", address: A }, { id: "2", address: B }]
  // Row 1 being edited to B must find row 2 as the owner.
  assert.equal(findAddressOwner(rows, B, "1")?.id, "2")
})

test("findAddressOwner: returns undefined when no row matches", () => {
  const rows = [{ id: "1", address: A }]
  assert.equal(findAddressOwner(rows, B), undefined)
})

test("findAddressOwner: match is case-sensitive", () => {
  const rows = [{ id: "1", address: MIXED_UPPER }]
  assert.equal(findAddressOwner(rows, MIXED_LOWER), undefined)
})

// --- splitByAddress (CSV import: retain, don't discard) ----------------------

test("splitByAddress: 200 rows with two sharing an address → 198 imported, 2 held back", () => {
  const SHARED = "TSHARED0000000000000000000000000z9"
  const rows = Array.from({ length: 200 }, (_, i) => ({
    address: `T${String(i).padStart(33, "0")}`,
  }))
  // File rows 4 and 12 are indices 2 and 10 (row number = index + 2).
  rows[2] = { address: SHARED }
  rows[10] = { address: SHARED }

  const split = splitByAddress(rows, (i) => i + 2)

  assert.equal(split.uniqueIndices.length, 198)
  // RETENTION: neither conflicting row is imported — a duplicate never picks a winner.
  assert.equal(split.uniqueIndices.includes(2), false)
  assert.equal(split.uniqueIndices.includes(10), false)

  assert.equal(split.conflicts.length, 1)
  const msg = split.conflicts[0]
  assert.match(msg, /Rows 4 and 12 share the same address \(/)
  assert.match(msg, /NOT imported/)
  // The address is truncated for display, never printed in full.
  assert.match(msg, /…/)
  assert.equal(msg.includes(SHARED), false)
})

test("splitByAddress: a 3-way collision is one message naming all three rows", () => {
  const rows = [{ address: A }, { address: A }, { address: A }]
  const split = splitByAddress(rows, (i) => i + 2)
  assert.equal(split.uniqueIndices.length, 0)
  assert.equal(split.conflicts.length, 1)
  assert.match(split.conflicts[0], /Rows 2, 3, and 4 share the same address/)
})

test("splitByAddress: nothing shared → every row imported, no conflicts", () => {
  const rows = [{ address: A }, { address: B }, { address: C }]
  const split = splitByAddress(rows, (i) => i + 2)
  assert.deepEqual(split.uniqueIndices, [0, 1, 2])
  assert.equal(split.conflicts.length, 0)
})

test("splitByAddress: case-only difference is kept as two distinct rows", () => {
  const rows = [{ address: MIXED_UPPER }, { address: MIXED_LOWER }]
  const split = splitByAddress(rows, (i) => i + 2)
  assert.deepEqual(split.uniqueIndices, [0, 1])
  assert.equal(split.conflicts.length, 0)
})

// --- groupAddressConflicts (UX-3: structured conflicts for the in-app resolver) ---
// Same detection as splitByAddress (both reuse findDuplicateAddresses) — but carries the
// ACTUAL competing rows + the file row number, so the resolver can show them side by side.

type Row = { name: string; address: string; amount: number }
const row = (name: string, address: string, amount: number): Row => ({ name, address, amount })

test("groupAddressConflicts: a 2-way conflict carries both rows with their file row numbers", () => {
  const rows: Row[] = [
    row("Priya", A, 1000),
    row("Sam", B, 500),
    row("Priya2", A, 2000),
  ]
  const groups = groupAddressConflicts(rows, (i) => i + 2)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].address, A)
  // The competing rows, in first-appearance order, each tagged with its file row (index + 2).
  assert.deepEqual(groups[0].candidates, [
    { row: rows[0], rowNumber: 2 },
    { row: rows[2], rowNumber: 4 },
  ])
})

test("groupAddressConflicts: a 3-way conflict is one group of three candidates", () => {
  const rows: Row[] = [row("A1", A, 1), row("A2", A, 2), row("A3", A, 3)]
  const groups = groupAddressConflicts(rows, (i) => i + 2)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].candidates.length, 3)
  assert.deepEqual(
    groups[0].candidates.map((c) => c.rowNumber),
    [2, 3, 4]
  )
})

test("groupAddressConflicts: all-unique → no groups", () => {
  const rows: Row[] = [row("A", A, 1), row("B", B, 2), row("C", C, 3)]
  assert.deepEqual(groupAddressConflicts(rows, (i) => i + 2), [])
})

test("groupAddressConflicts: case-only difference is NOT a conflict", () => {
  const rows: Row[] = [row("Up", MIXED_UPPER, 1), row("Low", MIXED_LOWER, 2)]
  assert.deepEqual(groupAddressConflicts(rows, (i) => i + 2), [])
})

test("groupAddressConflicts: two independent conflicts → two groups", () => {
  const rows: Row[] = [row("A1", A, 1), row("B1", B, 2), row("A2", A, 3), row("B2", B, 4)]
  const groups = groupAddressConflicts(rows, (i) => i + 2)
  assert.equal(groups.length, 2)
})

// --- resolveConflictPicks (UX-3: RETAIN, never auto-pick) --------------------

const twoWay: RowConflictGroup<Row> = {
  address: A,
  candidates: [
    { row: row("Priya", A, 1000), rowNumber: 4 },
    { row: row("Priya2", A, 2000), rowNumber: 5 },
  ],
}

test("resolveConflictPicks: NO selection → [] (the system never auto-picks a winner)", () => {
  assert.deepEqual(resolveConflictPicks([twoWay], {}), [])
})

test("resolveConflictPicks: a numeric pick returns exactly that row", () => {
  assert.deepEqual(resolveConflictPicks([twoWay], { [A]: 0 }), [twoWay.candidates[0].row])
  assert.deepEqual(resolveConflictPicks([twoWay], { [A]: 1 }), [twoWay.candidates[1].row])
})

test("resolveConflictPicks: 'discard' imports none of the group", () => {
  assert.deepEqual(resolveConflictPicks([twoWay], { [A]: "discard" }), [])
})

test("resolveConflictPicks: a 3-way, pick the middle → only the middle row", () => {
  const threeWay: RowConflictGroup<Row> = {
    address: A,
    candidates: [
      { row: row("first", A, 1), rowNumber: 2 },
      { row: row("middle", A, 2), rowNumber: 3 },
      { row: row("last", A, 3), rowNumber: 4 },
    ],
  }
  assert.deepEqual(resolveConflictPicks([threeWay], { [A]: 1 }), [threeWay.candidates[1].row])
})

test("resolveConflictPicks: multiple groups → at most one pick each; an unresolved group adds nothing", () => {
  const other: RowConflictGroup<Row> = {
    address: B,
    candidates: [
      { row: row("Bo", B, 10), rowNumber: 6 },
      { row: row("Bo2", B, 20), rowNumber: 7 },
    ],
  }
  // Group A resolved to candidate 1; group B left unresolved → only A's pick.
  assert.deepEqual(resolveConflictPicks([twoWay, other], { [A]: 1 }), [twoWay.candidates[1].row])
  // Both resolved → one pick each, in group order.
  assert.deepEqual(resolveConflictPicks([twoWay, other], { [A]: 0, [B]: 0 }), [
    twoWay.candidates[0].row,
    other.candidates[0].row,
  ])
})

test("resolveConflictPicks: an out-of-range index is ignored (never fabricates a row)", () => {
  assert.deepEqual(resolveConflictPicks([twoWay], { [A]: 9 }), [])
})
