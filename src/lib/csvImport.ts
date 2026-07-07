import Papa from "papaparse"

import { validatePayeeShape, type PayeeInput } from "@/lib/payeeValidation"

export type ParseResult =
  | { ok: true; rows: PayeeInput[] }
  | { ok: false; errors: string[] }

const REQUIRED_COLUMNS = ["name", "address", "amount"] as const

/** Strict, exact-match CSV parsing: the file must have columns literally
 *  named name/address/amount (role optional), case-insensitive. No alias
 *  guessing — for a money-adjacent import, an alias that guesses wrong for
 *  "address" or "amount" is worse than asking the user to rename a header. */
export function parseRosterCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  })

  if (parsed.errors.length > 0) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => `Row ${(e.row ?? 0) + 1} — ${e.message}`),
    }
  }

  const headers = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col))
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `This file is missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expects columns: name, address, amount — role optional.`,
      ],
    }
  }

  const errors: string[] = []
  const rows: PayeeInput[] = []

  parsed.data.forEach((raw, i) => {
    const result = validatePayeeShape({
      name: raw.name ?? "",
      role: raw.role ?? "",
      address: raw.address ?? "",
      amount: raw.amount ?? "",
    })
    if (result.ok) {
      rows.push(result.value)
    } else {
      errors.push(`Row ${i + 2} — ${result.errors.join(" ")}`)
    }
  })

  if (errors.length > 0) return { ok: false, errors }

  if (rows.length === 0) {
    return {
      ok: false,
      errors: ["This file doesn't have any payee rows. Add at least one and try again."],
    }
  }

  return { ok: true, rows }
}
