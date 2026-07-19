import { fromBaseUnits } from "@/lib/tron/amount"

// Shared display formatting for the 1B receipt PDF (the /api/affiliate/receipt
// route) and the public /verify page. Kept in one place so the PDF and the
// verification view can never disagree on how an amount or a date reads.
//
// NOTE: imports src/lib/tron/amount (→ config), which reads NEXT_PUBLIC_TRON_NETWORK
// at load. That's fine for the route + the server component (both run with env set);
// the PDF BUILDER (receiptPdf.ts) deliberately takes pre-formatted strings so it can
// be unit-tested without env — do NOT import this module there.

/** USDT base units (stringified uint) → grouped human amount, e.g. "1,450.5".
 *  Falls back to the raw string if it isn't a clean uint (never throws). */
export function formatUsdtAmount(baseUnits: string): string {
  try {
    const n = Number(fromBaseUnits(BigInt(baseUnits)))
    return n.toLocaleString("en-US", { maximumFractionDigits: 6 })
  } catch {
    return baseUnits
  }
}

/** A payout date in UTC — the on-chain instant when known, else when we indexed
 *  it. "14 Nov 2023" form; "—" if neither parses. */
export function formatUtcDate(blockTs: string | null, recordedAt: string): string {
  const src = blockTs ?? recordedAt
  const d = new Date(src)
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d)
}

/** TAbc…wXyz — a compact, non-doxxing rendering of a wallet. */
export function shortWallet(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}
