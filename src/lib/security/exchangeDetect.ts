// Advisory exchange-address detection for the payout pre-flight — the KNOWN-exchange list AND
// the classifier, kept in ONE self-contained module (no imports) so the node test runner can
// import it directly (the runner can't resolve extension-less relative imports, and every
// node-tested module in this repo is self-contained). Still "a versioned in-repo list, no DB".
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// GAP — READ THIS BEFORE TRUSTING A "not an exchange" RESULT. Declared, not hidden; do not fake.
//
//   1. TAGGED ADDRESSES ONLY. This matches exchange HOT/COLD/main wallets that are PUBLICLY
//      LABELLED. It does NOT cover an exchange's PER-USER DEPOSIT ADDRESS — the address a payee
//      actually pastes to cash out is a unique, unlabelled deposit address, so it will NOT match
//      here. A "false" (not-an-exchange) result therefore means "not a KNOWN exchange address",
//      never "definitely a personal wallet". This is the fundamental limit of the address-list
//      approach; the real signal needs behavioural/derivation analysis (pending research).
//
//   2. CREDIT POLICY UNKNOWN. Even on a hit, we do NOT know whether that exchange credits a
//      contract/internal (disperse) transfer in 2026. So the downstream disclaimer stays
//      GENERIC ("looks like an exchange — confirm they credit this kind of transfer"); it must
//      NOT claim to know the policy. Per-exchange credit specifics are a separate deep-research task.
//
//   3. PARTIAL COVERAGE. v1 seeds ONLY exchanges whose TRON addresses were verifiable from public
//      labels in this pass: Binance, HTX (Huobi), Gate. OKX, Bybit, MEXC, KuCoin, Bitget are
//      NOT yet seeded — their labelled TRON addresses were not verifiable here, and a fabricated
//      address is worse than an omission. Adding them is a follow-up (append entries below).
//
// Every address below was checked to be a checksum-valid TRON base58 address (tronweb.isAddress)
// before landing here. Sources: coincarp.com/currencies/tron/richlist + trx.tokenview.io labels.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ExchangeEntry = {
  /** Full TRON base58 address (case-sensitive; checksum-valid). */
  address: string
  /** Clean exchange name shown to the user (the generic flag). */
  exchange: string
  /** The public label the address carried, for provenance. */
  label: string
}

/** Bump when the list changes, so a downstream reader can record which snapshot it classified against. */
export const LIST_VERSION = "2026-07-19"

export const EXCHANGES: readonly ExchangeEntry[] = [
  // Binance
  { address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G", exchange: "Binance", label: "Binance (hot)" },
  { address: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb", exchange: "Binance", label: "Binance-Cold 2" },
  { address: "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf", exchange: "Binance", label: "Binance-Hot 7" },
  // HTX (Huobi)
  { address: "TYh6mgoMNZTCsgpYHBz7gttEfrQmDMABub", exchange: "HTX", label: "HTX Exchange" },
  { address: "TF2fmSbg5HAD34KPUH7WtWCxxvgXHohzYM", exchange: "HTX", label: "HTX" },
  { address: "THZovMcKoZaV9zzFTWteQYd2f3NEvnzxAM", exchange: "HTX", label: "HTX" },
  { address: "TDToUxX8sH4z6moQpK3ZLAN24eupu2ivA4", exchange: "HTX", label: "HTX 6" },
  { address: "TGn1uvntAVntT1pG8o7qoKkbViiYfeg6Gj", exchange: "HTX", label: "HTX-Cold 4" },
  { address: "TH7vVF9RTMXM9x7ZnPnbNcEph734hpu8cf", exchange: "HTX", label: "HTX-Cold 2" },
  { address: "TRSXRWudzfzY4jH7AaMowdMNUXDkHisbcd", exchange: "HTX", label: "HTX-Cold 3" },
  { address: "TAuUCiH4JVNBZmDnEDZkXEUXDARdGpXTmX", exchange: "HTX", label: "HTX-Cold 6" },
  // Gate
  { address: "TBA6CypYJizwA9XdC7Ubgc5F1bxrQ7SqPt", exchange: "Gate", label: "Gate" },
]

/** Exact, case-sensitive base58 lookup. TRON base58 is case-sensitive, so an address is
 *  matched only when it equals a listed address character-for-character. Built once. */
const BY_ADDRESS: ReadonlyMap<string, string> = new Map(
  EXCHANGES.map((e) => [e.address, e.exchange])
)

export type ExchangeMatch = {
  /** True only when `address` exactly matches a known, labelled exchange address. */
  isExchange: boolean
  /** The exchange name when matched (e.g. "Binance"); absent otherwise. */
  exchange?: string
}

/**
 * Classify a recipient address against the known-exchange list.
 *
 * ADVISORY ONLY (see the GAP above). A hit is a best-effort "this looks like exchange X"; it
 * does not assert the exchange's credit policy, and a miss does not assert the address is a
 * personal wallet (per-user deposit addresses are not covered). Pure — no I/O.
 */
export function classifyAddress(address: string): ExchangeMatch {
  if (typeof address !== "string" || address === "") return { isExchange: false }
  const exchange = BY_ADDRESS.get(address)
  return exchange ? { isExchange: true, exchange } : { isExchange: false }
}
