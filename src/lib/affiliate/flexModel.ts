// The Flex Card display model (Sprint 1C) — the PURE privacy logic behind the
// shareable payment image. It decides EXACTLY what text appears on a public,
// screenshot-able card, per the mandatory privacy toggle (D1.3).
//
// THE STRUCTURAL PRIVACY GUARANTEE: buildFlexModel never receives a wallet address —
// not the recipient/signer, not the paying agency. It works only from the whole-USDT
// magnitude, the public txid, the opaque Audit ID, the opaque referral code, and the
// site origin. So the model it returns CANNOT contain a wallet in ANY mode (D3.1) —
// a Twitter image is the worst possible surface to leak an address. Enforced by
// tests/affiliate/flexModel.test.ts.
//
// Pure (no env, no config, no secret, no DB) so it is unit-testable under plain
// `node --test`. The route does the config-dependent work (base-unit → whole USDT,
// exact formatting) and passes primitives in.

export type FlexMode = "hidden" | "range" | "exact"

/** The SAFE default (owner decision). A hurried payee who doesn't switch modes gets a
 *  card that reveals only a digit count — never a targetable figure. */
export const DEFAULT_FLEX_MODE: FlexMode = "hidden"

/** Coerce untrusted input to a valid mode, defaulting to the safe one. */
export function normalizeMode(mode: unknown): FlexMode {
  return mode === "range" || mode === "exact" ? mode : DEFAULT_FLEX_MODE
}

// Range buckets (whole USDT). The card shows "+{bucket} USDT" = the largest threshold
// at or below the amount, so it NEVER overstates what was actually paid.
const RANGE_THRESHOLDS: readonly bigint[] = [
  100n, 500n, 1_000n, 5_000n, 10_000n, 25_000n, 50_000n, 100_000n, 250_000n, 500_000n,
  1_000_000n,
]

/** Largest round threshold ≤ `wholeUsdt`, or null when the amount is below the
 *  smallest bucket (too small to state a range honestly → caller degrades to hidden). */
export function rangeBucket(wholeUsdt: bigint): bigint | null {
  if (wholeUsdt < RANGE_THRESHOLDS[0]) return null
  let bucket = RANGE_THRESHOLDS[0]
  for (const t of RANGE_THRESHOLDS) {
    if (wholeUsdt >= t) bucket = t
    else break
  }
  return bucket
}

/** Digit count of the whole-USDT integer part, e.g. 1450 → 4 ("4-figure"). Returns 0
 *  for a sub-1-USDT payment (caller shows a figure-less line). */
export function figureCount(wholeUsdt: bigint): number {
  if (wholeUsdt < 1n) return 0
  return wholeUsdt.toString().length
}

/** Group a non-negative bigint with thousands separators, e.g. 10000n → "10,000". */
export function groupThousands(n: bigint): string {
  const s = n.toString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export type FlexModel = {
  mode: FlexMode
  /** "On-Chain Verified" — the badge label. */
  badge: string
  /** The headline, rendered per the privacy mode. */
  amountPrimary: string
  /** A calm sub-line under the headline (mode-dependent). */
  amountSecondary: string
  /** The "letal line" quadrant — all public, non-wallet facts. */
  feeLine: string
  networkLine: string
  settledLine: string
  /** Truncated PUBLIC txid ("Tx: dead…beef") — the only on-chain identifier on the card. */
  txShort: string
  /** The capture QR target — the affiliate's OPAQUE /r/{code} (never a wallet). */
  qrUrl: string
  /** Honest capture copy (D3.2) — promises only what the landing delivers. */
  captureCopy: string
  /** EXACT mode only: the verifiable Audit ID printed for badge integrity (D4.1). */
  auditId?: string
  /** EXACT mode only: the /verify reference a skeptic can open to catch a montage. */
  verifyRef?: string
}

export type BuildFlexModelInput = {
  mode: FlexMode
  /** The payout amount in WHOLE USDT (base units / 10^6, integer part). */
  wholeUsdt: bigint
  /** The exact human amount, pre-formatted by the caller, e.g. "1,450.5". Used ONLY
   *  in exact mode. */
  exactDisplay: string
  /** The public disperse txid. */
  txid: string
  /** The verifiable Audit ID (from the 1B generated column). */
  auditId: string
  /** The affiliate's opaque referral code (mint-on-first-sign, 1A). */
  code: string
  /** Absolute site origin, e.g. "https://purserpay.app". */
  origin: string
}

const BADGE = "On-Chain Verified"
const FEE_LINE = "Intermediary fee: 0%"
const NETWORK_LINE = "TRON · USDT" // TRON · USDT
const SETTLED_LINE = "Settled & immutable"
// Honest (D3.2): the PAYOUT carries no intermediary cut — NOT a "no fees ever" / "free"
// claim (which reads as a free product and burns the lead at the 150/mo SaaS paywall).
// English-only, like the rest of the product (FIX-2).
const CAPTURE_COPY = "Get paid with zero intermediary fees"

function txShort(txid: string): string {
  const t = txid.trim()
  return t.length > 14 ? `Tx: ${t.slice(0, 6)}…${t.slice(-6)}` : `Tx: ${t}`
}

/**
 * Build the card model for `mode`. Returns ONLY renderable, non-wallet strings.
 * The amount headline is the sole mode-dependent field:
 *   * hidden — "{N}-figure payment" (or "Payment verified" for sub-1-USDT); no number.
 *   * range  — "+{bucket} USDT" (largest round threshold ≤ amount); degrades to hidden
 *              when the amount is below the smallest bucket (never overstates).
 *   * exact  — "{exactDisplay} USDT" + the Audit ID + a /verify reference (D4.1).
 */
export function buildFlexModel(input: BuildFlexModelInput): FlexModel {
  const { mode, wholeUsdt, exactDisplay, txid, auditId, code, origin } = input

  const base: FlexModel = {
    mode,
    badge: BADGE,
    amountPrimary: "",
    amountSecondary: "zero intermediary fees",
    feeLine: FEE_LINE,
    networkLine: NETWORK_LINE,
    settledLine: SETTLED_LINE,
    txShort: txShort(txid),
    qrUrl: `${origin}/r/${code}`,
    captureCopy: CAPTURE_COPY,
  }

  const hidden = (): FlexModel => {
    const n = figureCount(wholeUsdt)
    return {
      ...base,
      mode: "hidden",
      amountPrimary: n > 0 ? `${n}-figure payment` : "Payment verified",
    }
  }

  if (mode === "exact") {
    return {
      ...base,
      amountPrimary: `${exactDisplay} USDT`,
      amountSecondary: "verified on-chain",
      auditId,
      verifyRef: `${origin}/verify/${txid}?a=${auditId}`,
    }
  }

  if (mode === "range") {
    const bucket = rangeBucket(wholeUsdt)
    if (bucket === null) return hidden() // too small to state a range honestly
    return { ...base, amountPrimary: `+${groupThousands(bucket)} USDT` }
  }

  return hidden()
}
