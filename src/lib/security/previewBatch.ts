// Type-only imports (erased at runtime by type-stripping) so this module has NO runtime
// import and stays directly node-testable. The exchange classifier is INJECTED (`classify`),
// so previewBatch is fully pure — the caller (S-3) passes `classifyAddress` from exchangeDetect.
import type { BlacklistStatus } from "./blacklist"
import type { ExchangeMatch } from "./exchangeDetect"

// The payout pre-flight classifier: given each destination's blacklist status (blacklist.ts,
// fail-safe) and the exchange list (exchangeDetect.ts), assign every row ONE status the S-3
// dashboard renders BEFORE the operator signs. Pure — the blacklist read and the exchange
// classifier are inputs, so this is directly unit-testable under `node --test`.
//
// ORDER MIRRORS THE ON-CHAIN GUARD (contracts/src/PurserPay.sol `disperse`, S-1), so preview
// and execution never disagree:
//   on-chain: UnsupportedToken → length/empty → SenderBlacklisted (payer, once)
//             → per row: ZeroAddress/ZeroAmount → DestinationBlacklisted → transfer
//   preview : payer first (senderFrozen ⇒ whole batch reverts SenderBlacklisted), then per row
//             FROZEN (⇒ DestinationBlacklisted) as the top hard block.
// Format-invalid (address/amount) is handled at INSERTION (validatePayeeShape) and duplicates in
// S-0, so neither appears here. BLOCKED (balance/allowance) is supplied by the caller (usePayout's
// existing payable/shortfall math) — this module never recomputes balance.

export type RowStatus =
  | "READY" // nothing flagged
  | "FROZEN" // destination Tether-blacklisted → the on-chain guard hard-reverts this batch
  | "EXCHANGE" // looks like a known exchange address (advisory)
  | "UNVERIFIED" // blacklist read failed/absent (D-7) — cannot confirm safe, never treated as safe
  | "BLOCKED" // a pay-time block the existing logic already knows (balance/allowance)

export type PreviewRowInput = {
  id: string
  address: string
}

export type PreviewInput = {
  /** The paying wallet. Its own blacklist status maps to SenderBlacklisted on-chain. */
  payer: string
  rows: readonly PreviewRowInput[]
  /** Per-address blacklist status (from readBlacklistStatuses). An address MISSING from the
   *  map is treated as UNVERIFIED — absence is never SAFE (D-7 fail-safe). */
  statusByAddress: ReadonlyMap<string, BlacklistStatus>
  /** Row ids the existing pay-time logic already blocks (balance/allowance). Reused from
   *  usePayout — previewBatch does NOT recompute balance. */
  blockedIds?: ReadonlySet<string>
  /** The exchange classifier, INJECTED (keeps this module pure + node-testable). Callers pass
   *  `classifyAddress` from exchangeDetect.ts. */
  classify: (address: string) => ExchangeMatch
}

export type PreviewRow = {
  id: string
  address: string
  status: RowStatus
  /** Populated WHENEVER the address is a known exchange, regardless of `status` (orthogonal
   *  metadata) — so a frozen-and-exchange row still carries the exchange name. */
  exchange?: string
  /** Short machine reason, for logs/UI. */
  reason?: string
}

export type BatchPreview = {
  payer: string
  /** The payer's own blacklist status (SAFE / FROZEN / UNVERIFIED). */
  payerStatus: BlacklistStatus
  /** payerStatus === "FROZEN": the whole batch reverts SenderBlacklisted at sign time. */
  senderFrozen: boolean
  rows: PreviewRow[]
  /** Any hard on-chain block exists (sender frozen OR any FROZEN row) — the disperse would
   *  revert. UNVERIFIED and BLOCKED are NOT counted here (advisory / pay-time, not a guard revert). */
  hasFrozen: boolean
}

function statusFor(
  address: string,
  statusByAddress: ReadonlyMap<string, BlacklistStatus>
): BlacklistStatus {
  // D-7: an address we have no reading for is UNVERIFIED, never SAFE.
  return statusByAddress.get(address) ?? "UNVERIFIED"
}

/**
 * Classify every row for the pre-flight. See the module header for the status precedence and
 * why it mirrors the S-1 guard order.
 */
export function previewBatch(input: PreviewInput): BatchPreview {
  const { payer, rows, statusByAddress, blockedIds, classify } = input

  // Payer first — mirrors SenderBlacklisted running before any row's destination check.
  const payerStatus = statusFor(payer, statusByAddress)
  const senderFrozen = payerStatus === "FROZEN"

  let hasFrozen = senderFrozen

  const outRows: PreviewRow[] = rows.map((row) => {
    const dest = statusFor(row.address, statusByAddress)
    const match = classify(row.address)
    // `exchange` is orthogonal to `status`: always attach the name on a hit.
    const exchange = match.isExchange ? match.exchange : undefined

    // Precedence (highest first): FROZEN > UNVERIFIED > BLOCKED > EXCHANGE > READY.
    let status: RowStatus
    let reason: string | undefined
    if (dest === "FROZEN") {
      status = "FROZEN"
      reason = "destination_blacklisted"
      hasFrozen = true
    } else if (dest === "UNVERIFIED") {
      status = "UNVERIFIED"
      reason = "blacklist_unverified"
    } else if (blockedIds?.has(row.id)) {
      status = "BLOCKED"
      reason = "pay_time_blocked"
    } else if (match.isExchange) {
      status = "EXCHANGE"
      reason = "exchange_address"
    } else {
      status = "READY"
    }

    return exchange
      ? { id: row.id, address: row.address, status, exchange, reason }
      : { id: row.id, address: row.address, status, reason }
  })

  return { payer, payerStatus, senderFrozen, rows: outRows, hasFrozen }
}
