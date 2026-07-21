// Pure view-model for the S-3 dashboard pre-flight — the badge/banner DECISIONS, extracted from
// the React components so they are directly unit-testable under `node --test` (the repo has no
// React test infra; every tested module is self-contained). The components (columns.tsx,
// PreflightBanner, VerifyBadge) are thin renderers over these descriptors.
//
// VISUAL DOCTRINE (owner-CLOSED — encoded here, asserted in tests):
//   • GREEN = PAID, and ONLY paid. NOTHING in this module ever emits a "success/paid" tone — a
//     ready/clean/safe row returns kind "none" (no security badge; absence of alarm = ok).
//   • FROZEN is a hard block, always-visible (a `frozen` descriptor `blocks: true`, tone "danger").
//   • Hover-only detail is for NON-blocking states (exchange, unverified) — they never block.
//
// Precedence mirrors previewBatch.ts (and thus the S-1 on-chain guard): FROZEN > UNVERIFIED >
// EXCHANGE > clean. `exchange` is orthogonal metadata (attached whenever the address matches a
// known exchange), so a frozen-and-exchange row is still primarily FROZEN but keeps the name.

/** The blacklist-derived security state of one row (mutually exclusive). `exchange` is separate. */
export type SecurityKind =
  | "none" // clean / known-safe — NO security badge (never green; green is paid-only)
  | "checking" // blacklist read in flight for this batch — neutral, never assumed safe (D-7)
  | "frozen" // destination Tether-blacklisted — red, ALWAYS visible, blocks the row
  | "unverified" // blacklist read failed/absent (D-7) — muted, advisory, does NOT block

/** The visual tone a chip may carry. Deliberately has NO "success"/"paid" member — green is
 *  reserved for the paid state and must never be reachable from a security descriptor. */
export type SecurityTone = "danger" | "warning" | "muted"

export type RowSecurity = {
  kind: SecurityKind
  /** True ONLY for `frozen` — the row joins the "can't pay" set and can never reach a signature. */
  blocks: boolean
  /** Known-exchange name (e.g. "Binance"), orthogonal to `kind`; drives the amber chip. */
  exchange?: string
}

/**
 * Classify one row's security signals into a single render descriptor.
 *
 * Precedence for `kind`: frozen > checking > unverified > none. `exchange` is attached whenever
 * present, regardless of `kind` (a frozen exchange address is FROZEN but still names the exchange).
 * A clean row (no frozen/checking/unverified) returns kind "none" — NEVER a green/paid tone.
 */
export function rowSecurityFor(input: {
  frozen?: boolean
  unverified?: boolean
  checking?: boolean
  exchange?: string
}): RowSecurity {
  const exchange = input.exchange || undefined
  if (input.frozen) return { kind: "frozen", blocks: true, exchange }
  if (input.checking) return { kind: "checking", blocks: false, exchange }
  if (input.unverified) return { kind: "unverified", blocks: false, exchange }
  return { kind: "none", blocks: false, exchange }
}

/** The tone for a non-blocking trailing chip. Exported so the column and the tests agree on the
 *  mapping (and so the "never success" invariant is checkable). frozen → danger, unverified →
 *  muted, exchange chip → warning (amber). */
export function toneForKind(kind: SecurityKind): SecurityTone {
  switch (kind) {
    case "frozen":
      return "danger"
    case "unverified":
    case "checking":
      return "muted"
    default:
      return "muted"
  }
}

/**
 * True if ANY row is a hard block (frozen). The pay executor asserts `!hasBlockingRow(...)` right
 * before it signs, so a batch that contains a frozen row can NEVER reach a signature (Task 4
 * invariant — the on-chain guard would revert it anyway, but we stop it here, calmly, first).
 */
export function hasBlockingRow(rows: ReadonlyArray<{ frozen?: boolean }>): boolean {
  return rows.some((r) => Boolean(r.frozen))
}

// ── The single primary line (Sprint UX-2) ──────────────────────────────────────────────────────
// The address cell shows EXACTLY ONE primary line (plus an orthogonal amber Exchange? chip). This
// merges the wallet double-check (paid-before / invalid, from validation.ts) with the eager frozen
// pre-flight (frozen / verifying / unverified) into one precedence-resolved descriptor. The grey
// "Format ok" resting state is GONE: a well-formed row is either Verifying… (read queued/in-flight)
// or one of the resolved states — never a limbo badge.

/** The mutually-exclusive primary line for the address cell. NOTE: there is deliberately NO
 *  "format-ok"/"valid-format" member — a well-formed row resolves to `valid` (or is `verifying`
 *  until its read lands), it never sits in a grey limbo. */
export type RowLine =
  | "invalid" // structurally invalid (isAddress false) — red, blocks
  | "frozen" // Tether-blacklisted destination — red, ALWAYS visible, blocks
  | "verifying" // eager blacklist read queued/in-flight — neutral, TRANSIENT, never assumed safe
  | "unverified" // blacklist read failed/absent (D-7) — muted, never green, never blocks
  | "paid-before" // ✓✓ the connected wallet paid this address before — success (green)
  | "valid" // ✓ passed the on-chain pre-flight, clean — primary (aqua), NOT green

/** The visual tone a primary line carries. `success` (green) is reserved for `paid-before` — the
 *  GREEN = PAID invariant. `valid` ("clean") is `primary` (aqua), NEVER success. */
export type LineTone = "success" | "primary" | "danger" | "muted"

/**
 * Resolve the single primary line for a row from its combined signals.
 *
 * Precedence (safety-first): invalid > frozen > paid-before > verifying > unverified > valid.
 *   • Danger (invalid/frozen) always wins — a frozen row is never masked by a positive signal.
 *   • `paid-before` keeps its precedence over the TRANSIENT `verifying` (a known ✓✓ is not downgraded
 *     to "Verifying…" during an eager re-read); frozen still overrides it (a since-frozen address
 *     that you paid before must show frozen).
 *   • `verifying` (in-flight) outranks `unverified` (a prior miss) — the fresh read beats the stale.
 *   • `valid` (clean) is the lowest — the resting positive state, only after a SAFE read.
 */
export function rowLineFor(input: {
  invalid?: boolean
  paidBefore?: boolean
  frozen?: boolean
  verifying?: boolean
  unverified?: boolean
}): RowLine {
  if (input.invalid) return "invalid"
  if (input.frozen) return "frozen"
  if (input.paidBefore) return "paid-before"
  if (input.verifying) return "verifying"
  if (input.unverified) return "unverified"
  return "valid"
}

/**
 * The tone for a primary line. `paid-before` is the ONLY line that maps to `success` (green) — the
 * machine-checked GREEN = PAID guardrail. A pre-flight-clean `valid` row is `primary` (aqua), never
 * green; the transient/advisory states are `muted`; danger is `danger`.
 */
export function lineTone(line: RowLine): LineTone {
  switch (line) {
    case "paid-before":
      return "success" // the ONLY green — green = paid
    case "valid":
      return "primary" // aqua; NOT green
    case "invalid":
    case "frozen":
      return "danger"
    case "verifying":
    case "unverified":
      return "muted"
  }
}

export type PreflightSummary = {
  frozen: number
  exchange: number
  unverified: number
  /** True when the banner has anything to say (≥1 flagged row) — the banner hides otherwise. */
  anything: boolean
}

/**
 * Summarize a batch for the contextual banner. Each row lands in EXACTLY ONE bucket by the same
 * precedence as `rowSecurityFor` (frozen > unverified > exchange), so the counts sum to the number
 * of flagged rows and a frozen-and-exchange row is counted once (as frozen, the salient alarm).
 * A clean batch → all zero, `anything: false` (render no banner — zero noise).
 */
export function summarizePreflight(
  rows: ReadonlyArray<{ frozen?: boolean; unverified?: boolean; exchange?: string }>
): PreflightSummary {
  let frozen = 0
  let unverified = 0
  let exchange = 0
  for (const r of rows) {
    if (r.frozen) frozen++
    else if (r.unverified) unverified++
    else if (r.exchange) exchange++
  }
  return { frozen, exchange, unverified, anything: frozen + unverified + exchange > 0 }
}
