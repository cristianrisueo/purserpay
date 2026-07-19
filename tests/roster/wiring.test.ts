// Sprint S-0 — structural guard for the dedupe wiring. The enforcement points
// (roster.ts, csvImport.ts, the two dialogs) import via the `@/` alias, which the
// node test runner can't resolve, so they can't be imported here. This scans their
// source to prove the dedupe helper is actually wired into every insertion path —
// the pure logic itself is covered by dedupe.test.ts. No network, no DB.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8")

const ROSTER = read("../../src/lib/roster.ts")
const CSV_IMPORT = read("../../src/lib/csvImport.ts")
const FORM_DIALOG = read("../../src/components/dashboard/PayeeFormDialog.tsx")
const IMPORT_DIALOG = read("../../src/components/dashboard/ImportCsvDialog.tsx")

// --- Manual add/edit: roster.ts guards both paths ----------------------------

test("roster.ts imports the shared dedupe helper", () => {
  assert.match(ROSTER, /from "@\/lib\/rosterDedupe"/)
})

test("addPayee guards against an existing address (no excludeId)", () => {
  assert.match(ROSTER, /findAddressOwner\(existing, value\.address\)/)
})

test("updatePayee guards but excludes the row being edited", () => {
  assert.match(ROSTER, /findAddressOwner\(existing, value\.address, id\)/)
})

test("replaceRoster has the defense-in-depth duplicate guard", () => {
  assert.match(ROSTER, /findDuplicateAddresses\(values\)/)
})

// --- CSV import: uniques imported, conflicts retained ------------------------

test("applyMapping splits by address and returns the retained conflicts", () => {
  assert.match(CSV_IMPORT, /splitByAddress\(/)
  assert.match(CSV_IMPORT, /conflicts: split\.conflicts/)
})

// --- Dialogs surface / gate on the dedupe result -----------------------------

test("PayeeFormDialog surfaces a persist-time rejection (duplicate) via submitError", () => {
  assert.match(FORM_DIALOG, /catch \(err\)/)
  assert.match(FORM_DIALOG, /setSubmitError\(/)
})

test("ImportCsvDialog never clear-then-imports-nothing (guards on rows.length === 0)", () => {
  assert.match(IMPORT_DIALOG, /mappingResult\.rows\.length === 0/)
})
