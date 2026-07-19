/** Grouped, no-decimal USDT amount, e.g. 11040 → "11,040". */
export function formatUsdt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)
}

/** Middle-ellipsis a TRON address for display; full value belongs in `title`. */
export function truncateAddress(address: string, lead = 6, tail = 5): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

/** The last `n` characters of an address — the "confirm this is correct" tail shown on add/edit
 *  to kill a pasted-corrupted (clipboard-malware) address. Safe on short/empty strings. */
export function lastChars(address: string, n = 6): string {
  if (typeof address !== "string") return ""
  return address.slice(-n)
}

/** Human long date, e.g. "July 10, 2026". Defaults to today. */
export function formatLongDate(when: number | Date = new Date()): string {
  const date = typeof when === "number" ? new Date(when) : when
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(date)
}

/** The payout heading used on the dashboard and the PDF receipt, e.g.
 *  "Payout: July 10, 2026". One source of truth so both stay identical. */
export function payoutTitle(when: number | Date = new Date()): string {
  return `Payout: ${formatLongDate(when)}`
}
