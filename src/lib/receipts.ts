import { db, type StoredMeta, type StoredPayment } from "@/lib/db"
import { NETWORK } from "@/lib/tron/config"
import type { ConfirmedBatch } from "@/lib/tron/disperse"

// Persisted payout receipts. Green ("paid") is DERIVED from these, so a paid
// row stays paid across a reload and can't be accidentally re-paid. All
// client-side (IndexedDB) — no server, same as the roster.

export type PaymentReceipt = StoredPayment

/** Persist a confirmed disperse batch as a receipt. Called only after the tx's
 *  on-chain receipt reports SUCCESS. */
export async function addReceipt(batch: ConfirmedBatch): Promise<void> {
  await db.payments.add({
    id: crypto.randomUUID(),
    txid: batch.txid,
    network: NETWORK.key,
    timestamp: Date.now(),
    payeeIds: batch.rowIds,
    recipients: batch.recipients,
    totalBaseUnits: batch.totalBaseUnits,
  })
}

/** Wipe all receipts (hard reset — not used by the normal Reset button, which
 *  only advances the green cycle). */
export async function clearReceipts(): Promise<void> {
  await db.payments.clear()
}

const GREEN_SINCE_KEY = "greenSince"

/** Start of the current green cycle (ms). Receipts older than this are kept as
 *  history but no longer paint a row green — that's what lets next month's
 *  payout of the same roster proceed. */
export function greenSince(meta: StoredMeta | undefined): number {
  return meta?.value ?? 0
}

/** Advance the green cycle to now: the Reset action. Keeps every receipt. */
export async function advanceGreenCycle(): Promise<void> {
  await db.meta.put({ key: GREEN_SINCE_KEY, value: Date.now() })
}

export const GREEN_SINCE_META_KEY = GREEN_SINCE_KEY

/** Roster ids paid in the CURRENT cycle on the CURRENT network. A payment on
 *  another network, or before the last Reset, never greens a row here. */
export function paidPayeeIds(
  payments: StoredPayment[],
  since: number
): Set<string> {
  const ids = new Set<string>()
  for (const p of payments) {
    if (p.network !== NETWORK.key || p.timestamp < since) continue
    for (const id of p.payeeIds) ids.add(id)
  }
  return ids
}

/** The most recent payment (batch) that paid a given roster id in the current
 *  cycle — the source for both the Tronscan link and the downloadable receipt. */
export function paymentForPayee(
  payments: StoredPayment[],
  payeeId: string,
  since: number
): StoredPayment | null {
  let latest: StoredPayment | null = null
  for (const p of payments) {
    if (p.network !== NETWORK.key || p.timestamp < since) continue
    if (!p.payeeIds.includes(payeeId)) continue
    if (!latest || p.timestamp > latest.timestamp) latest = p
  }
  return latest
}

/** The txid that paid a given roster id in the current cycle (most recent),
 *  for surfacing a Tronscan link on a paid row. */
export function txidForPayee(
  payments: StoredPayment[],
  payeeId: string,
  since: number
): string | null {
  return paymentForPayee(payments, payeeId, since)?.txid ?? null
}
