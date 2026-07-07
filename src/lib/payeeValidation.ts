export type PayeeInput = {
  name: string
  role: string
  address: string
  amount: number
}

export type ValidationResult =
  | { ok: true; value: PayeeInput }
  | { ok: false; errors: string[] }

// Shape only — starts with T, ~34 base58-ish characters. NOT the real Sprint
// 3B on-chain/checksum validation; this just rejects obviously-wrong input
// (empty cell, a pasted 0x… address, a truncated paste).
const TRON_ADDRESS_SHAPE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

/** Parses a money-field string into a positive finite number. Strips
 *  thousands separators and surrounding whitespace; rejects everything else. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "")
  if (cleaned === "") return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Validates one payee's shape. Accepts loose string inputs (form fields,
 *  CSV cells) and returns a clean PayeeInput or a list of field errors. */
export function validatePayeeShape(raw: {
  name: string
  role?: string
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
    value: { name, role: (raw.role ?? "").trim(), address, amount: amount! },
  }
}
