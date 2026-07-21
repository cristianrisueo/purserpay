export type PayeeInput = {
  name: string
  address: string
  amount: number
}

export type ValidationResult =
  | { ok: true; value: PayeeInput }
  | { ok: false; errors: string[] }

// Shape only — starts with T, ~34 base58-ish characters. NOT the real Sprint
// 3B on-chain/checksum validation; this just rejects obviously-wrong input
// (empty cell, a pasted 0x… address, a truncated paste). Exported so the CSV
// importer can reuse the exact same shape check to detect a missing header
// row (a real address value sitting where a header should be).
export const TRON_ADDRESS_SHAPE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

// Plain digits, or US-grouped thousands (comma every 3 digits), with an
// optional "." decimal — and nothing else. Checked BEFORE any parsing so
// JS's own permissive number coercion never gets a say: unchecked, Number()
// silently accepts scientific notation ("1E2" → 100) and hex ("0x10" → 16),
// and naively stripping commas silently misreads a European "1.234,56" (a
// human's 1234.56) as 1.23456 — wrong money, not an error. Reject all of it.
const AMOUNT_SHAPE = /^\d+(\.\d+)?$|^\d{1,3}(,\d{3})+(\.\d+)?$/

/** Parses a money-field string into a positive finite number. Strips valid
 *  US-style thousands separators and surrounding whitespace; rejects
 *  anything that isn't unambiguously a plain positive number. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.trim()
  if (cleaned === "" || !AMOUNT_SHAPE.test(cleaned)) return null
  const n = Number(cleaned.replace(/,/g, ""))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Validates one payee's shape. Accepts loose string inputs (form fields,
 *  CSV cells) and returns a clean PayeeInput or a list of field errors. */
export function validatePayeeShape(raw: {
  name: string
  address: string
  amount: string | number
}): ValidationResult {
  const errors: string[] = []

  const name = raw.name.trim()
  if (!name) errors.push("Name is required.")

  const address = raw.address.trim()
  if (!address) {
    errors.push("Address is required.")
  } else if (!TRON_ADDRESS_SHAPE.test(address)) {
    errors.push("Address doesn't look like a TRON address.")
  }

  const amount =
    typeof raw.amount === "number" ? raw.amount : parseAmount(raw.amount)
  if (amount == null) {
    errors.push("Amount must be a positive number.")
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: { name, address, amount: amount! },
  }
}
