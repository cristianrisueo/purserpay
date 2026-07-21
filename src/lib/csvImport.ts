import Papa from "papaparse"

import {
  parseAmount,
  TRON_ADDRESS_SHAPE,
  validatePayeeShape,
  type PayeeInput,
} from "@/lib/payeeValidation"
import {
  groupAddressConflicts,
  splitByAddress,
  type RowConflictGroup,
} from "@/lib/rosterDedupe"

export type FieldKey = "name" | "role" | "address" | "amount"

/** Header string the user picked for each field. `role` absent = not mapped. */
export type ColumnMapping = Partial<Record<FieldKey, string>>

export type RawCsvTable = {
  headers: string[]
  rows: Record<string, string>[]
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Name",
  address: "Address",
  amount: "USDT amount",
  role: "Role",
}

const REQUIRED_FIELDS: readonly FieldKey[] = ["name", "address", "amount"]

export type TableParseResult =
  | { ok: true; table: RawCsvTable }
  | { ok: false; errors: string[] }

/** Parses a CSV into raw headers + string rows — no field validation, no
 *  required-column check. The user maps columns to fields themselves on the
 *  next screen; this step only needs to know the file is readable and has
 *  something in it. Headers are trimmed but NOT case-normalized — they're
 *  shown to the user verbatim in the mapping dropdowns, and matching from
 *  here on is by exact string key against the file's own headers, never
 *  against a hardcoded literal. */
export function parseCsvTable(text: string): TableParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  // "UndetectableDelimiter" fires whenever the file has no comma at all
  // (e.g. a genuinely single-column CSV) — Papa still parses correctly by
  // defaulting to comma, so it's not fatal. Surfacing it as-is would show a
  // real, valid single-column file a scary internal parser message instead
  // of just... parsing it.
  const fatalErrors = parsed.errors.filter(
    (e) => e.code !== "UndetectableDelimiter"
  )
  if (fatalErrors.length > 0) {
    return {
      ok: false,
      errors: fatalErrors.map((e) => `Row ${(e.row ?? 0) + 1} — ${e.message}`),
    }
  }

  const headers = (parsed.meta.fields ?? []).filter((h) => h.length > 0)
  if (headers.length === 0) {
    return {
      ok: false,
      errors: ["This file doesn't have any columns we can read."],
    }
  }

  // Papa always treats row 1 as headers — it can't tell a real header row
  // from a headerless file's first payee row. Never silently consume a real
  // row as headers (that would map money off a person's name/address). If
  // any "header" cell already looks like a payee value — a positive number
  // (the amount column) or something TRON-address-shaped — this almost
  // certainly isn't a header row at all.
  const looksHeaderless = headers.some(
    (h) => parseAmount(h) !== null || TRON_ADDRESS_SHAPE.test(h.trim())
  )
  if (looksHeaderless) {
    return {
      ok: false,
      errors: [
        "This file doesn't seem to have a header row. Add a first row naming your columns (for example: name, address, amount) and upload it again.",
      ],
    }
  }

  if (parsed.data.length === 0) {
    return {
      ok: false,
      errors: [
        "This file doesn't have any payee rows. Add at least one and try again.",
      ],
    }
  }

  return { ok: true, table: { headers, rows: parsed.data } }
}

export type MappingApplyResult =
  | {
      ok: true
      /** The unique rows, safe to import immediately. */
      rows: PayeeInput[]
      /** One human message per conflicting address group (the S-0 retention text). */
      conflicts: string[]
      /** The same conflicts as structured, competing rows — for the in-app resolver (UX-3). */
      conflictGroups: RowConflictGroup<PayeeInput>[]
    }
  | { ok: false; errors: string[] }

/** Builds validated payee rows from the raw table using the user's own
 *  column mapping. Reuses the exact same validatePayeeShape rules as the
 *  manual add/edit form, and collects ALL shape errors in one pass (any shape
 *  error blocks the whole import). Once shapes pass, it dedupes WITHIN the file:
 *  `rows` is the unique addresses (imported) and `conflicts` names the rows held
 *  back for sharing an address (retained, never discarded — see splitByAddress).
 *  Caller is expected to only call this once every required field has been mapped
 *  (see describeMappingCollision + the missing-fields check in the dialog); this
 *  still guards defensively. */
export function applyMapping(
  table: RawCsvTable,
  mapping: ColumnMapping
): MappingApplyResult {
  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f])
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `Choose a column for ${missing.map((f) => FIELD_LABELS[f]).join(", ")} to continue.`,
      ],
    }
  }

  const errors: string[] = []
  const rows: PayeeInput[] = []

  table.rows.forEach((raw, i) => {
    const result = validatePayeeShape({
      name: raw[mapping.name!] ?? "",
      role: mapping.role ? (raw[mapping.role] ?? "") : "",
      address: raw[mapping.address!] ?? "",
      amount: raw[mapping.amount!] ?? "",
    })
    if (result.ok) {
      rows.push(result.value)
    } else {
      errors.push(`Row ${i + 2} — ${result.errors.join(" ")}`)
    }
  })

  if (errors.length > 0) return { ok: false, errors }

  // Defense-in-depth only: parseCsvTable already guarantees at least one data
  // row, so this can't normally trigger (every row failing would already
  // have returned via the branch above).
  if (rows.length === 0) {
    return {
      ok: false,
      errors: ["This file doesn't have any payee rows. Add at least one and try again."],
    }
  }

  // Dedupe within the file. RETENTION, not discard: every row sharing an address
  // is held back (none imported) so a duplicate never silently picks a winner. Since
  // UX-3 the user resolves those IN-APP (the resolver reads `conflictGroups`), instead
  // of re-editing their spreadsheet — but the rule is unchanged: uniques import, the
  // conflicting rows import to NEITHER until the user explicitly picks one. Because
  // replaceRoster is a clear + bulkAdd of the whole file, "import uniques" means write
  // ONLY the non-conflicting rows here; the picks are appended afterward. Every shape
  // error already returned above, so rows[i] maps 1:1 to table.rows[i] and the file row
  // number is i + 2 (header + 1-based), matching the "Row ${i + 2}" shape messages.
  const split = splitByAddress(rows, (i) => i + 2)
  const uniques = split.uniqueIndices.map((i) => rows[i])
  const conflictGroups = groupAddressConflicts(rows, (i) => i + 2)
  return { ok: true, rows: uniques, conflicts: split.conflicts, conflictGroups }
}

/** Blocks a mapping where two different fields point at the identical
 *  source column — e.g. Address and Amount both mapped to the same header.
 *  Checked as its own step rather than left to fall through to per-row
 *  validation, which would otherwise surface as a wall of confusing
 *  "doesn't look like a TRON address" errors instead of naming the actual
 *  mistake. Built as a reverse index so 3-way collisions (all fields
 *  pointed at one column) are caught with the same code path as a 2-way. */
export function describeMappingCollision(mapping: ColumnMapping): string | null {
  const byHeader = new Map<string, FieldKey[]>()

  for (const field of ["name", "role", "address", "amount"] as const) {
    const header = mapping[field]
    if (!header) continue
    const fields = byHeader.get(header) ?? []
    fields.push(field)
    byHeader.set(header, fields)
  }

  for (const fields of byHeader.values()) {
    if (fields.length > 1) {
      const names = fields.map((f) => FIELD_LABELS[f])
      const joined =
        names.length === 2
          ? names.join(" and ")
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
      const verb = names.length === 2 ? "are both" : "are all"
      return `${joined} ${verb} mapped to the same column. Choose a different column for each.`
    }
  }

  return null
}
