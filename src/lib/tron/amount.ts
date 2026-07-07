import { USDT_DECIMALS } from "./config"

// Human USDT amount → raw 6-decimal base units, and back. The contract does no
// decimal math — this boundary is the ONLY place the ×10^6 conversion happens,
// and it must be exact. We never do `n * 1e6`: floating-point multiply turns a
// clean "0.07 USDT" into 70000.00000000001 and a wrong on-chain amount. Instead
// we work on the decimal STRING, so the money is always exactly what was typed.

const ONE_UNIT = 10n ** BigInt(USDT_DECIMALS)

/** Thrown when an amount can't be represented exactly in USDT base units
 *  (more than 6 decimal places, or not a positive plain number). Surfacing
 *  this is correct: silently rounding someone's pay is the failure this
 *  product exists to prevent. */
export class AmountError extends Error {}

/** Exact human amount → base units (bigint). Accepts a number (as stored in
 *  the roster) or a plain decimal string. Rejects negatives, zero, non-finite,
 *  scientific notation, and >6 decimal places. */
export function toBaseUnits(human: number | string): bigint {
  let s: string
  if (typeof human === "number") {
    if (!Number.isFinite(human)) throw new AmountError("Amount is not a finite number.")
    // Avoid scientific notation for realistic payout sizes; anything that
    // still stringifies with an "e" is out of range and rejected below.
    s = String(human)
  } else {
    s = human.trim()
  }

  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new AmountError(`Amount "${s}" is not a plain positive number.`)
  }

  const [intPart, fracPartRaw = ""] = s.split(".")
  if (fracPartRaw.length > USDT_DECIMALS) {
    throw new AmountError(
      `Amount "${s}" has more than ${USDT_DECIMALS} decimal places — USDT can't represent it exactly.`
    )
  }

  const fracPart = fracPartRaw.padEnd(USDT_DECIMALS, "0")
  const units = BigInt(intPart) * ONE_UNIT + BigInt(fracPart)
  if (units <= 0n) throw new AmountError("Amount must be greater than zero.")
  return units
}

/** Base units (bigint) → a trimmed decimal string, e.g. 1450500000n → "1450.5".
 *  For receipts and reconciliation; UI display uses formatUsdt on the number. */
export function fromBaseUnits(units: bigint): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const whole = abs / ONE_UNIT
  const frac = abs % ONE_UNIT
  const fracStr = frac.toString().padStart(USDT_DECIMALS, "0").replace(/0+$/, "")
  const body = fracStr ? `${whole}.${fracStr}` : `${whole}`
  return negative ? `-${body}` : body
}

/** Sum a list of human amounts as exact base units. */
export function sumBaseUnits(humans: Array<number | string>): bigint {
  return humans.reduce<bigint>((acc, h) => acc + toBaseUnits(h), 0n)
}
