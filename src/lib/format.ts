/** Grouped, no-decimal USDT amount, e.g. 11040 → "11,040". */
export function formatUsdt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)
}

/** Middle-ellipsis a TRON address for display; full value belongs in `title`. */
export function truncateAddress(address: string, lead = 6, tail = 5): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}
