import { USDT_ADDRESS, HISTORY_WINDOW_DAYS } from "./config"
import {
  getInjectedTronWeb,
  isValidTronAddress,
  providerHost,
} from "./client"

// The ✓ / ✓✓ double-check — the "zero fear" heart of the table, and the most
// privacy-sensitive read in the app. Its design is load-bearing:
//
//  invalid       — fails tronWeb.isAddress. OFFLINE, nothing leaves the device.
//  valid-format  — structurally valid, but on-chain status not (yet) known
//                  (before connect, or if the indexer is unavailable).
//  valid  (✓)    — activated account on-chain (a real, used TRON address).
//  paid-before(✓✓) — the CONNECTED wallet has sent USDT to this exact address
//                  within HISTORY_WINDOW_DAYS.
//
// THE NON-NEGOTIABLE PRIVACY INVARIANT (see CLAUDE.md — data never leaves the
// device): the ✓✓ history read sends exactly ONE address — the operator's own
// wallet W — to the node, and only to the provider the user's own wallet
// already talks to. It asks "what did W send?" and matches the returned payee
// addresses LOCALLY. Payee addresses are never transmitted for ✓✓. There is no
// Purser server, no Purser API key, no Purser-controlled endpoint in this path.
// If the provider can't answer (a bare node with no indexer), ✓✓ degrades to
// "valid" / "valid-format" — it is NEVER replaced by a Purser-side call.

export type VerifyLevel = "invalid" | "valid-format" | "valid" | "paid-before"

export type VerifyResult = {
  /** address (base58) → level. */
  levels: Map<string, VerifyLevel>
  /** true when on-chain history/activation couldn't be read (indexer absent,
   *  offline, or not connected) — the UI can note ✓✓ is unavailable. */
  degraded: boolean
}

/** Offline, synchronous, nothing leaves the device. The pre-connect baseline. */
export function structuralLevel(address: string): VerifyLevel {
  return isValidTronAddress(address) ? "valid-format" : "invalid"
}

/** Structural-only map for a whole roster (pre-connect / instant). */
export function structuralLevels(addresses: string[]): Map<string, VerifyLevel> {
  const m = new Map<string, VerifyLevel>()
  for (const a of addresses) m.set(a, structuralLevel(a))
  return m
}

// --- ✓✓ history: ONE query for the operator's own outgoing USDT --------------

/** Fetch the set of addresses W has *sent USDT to* within the window, reading
 *  through the user's own provider host. Only W is sent; the `to` addresses in
 *  the response are matched locally by the caller. Returns null if the provider
 *  can't answer (→ degrade, never a Purser fallback). */
async function fetchRecentlyPaid(
  operator: string,
  host: string,
  signal?: AbortSignal
): Promise<Set<string> | null> {
  if (!host) return null
  const base = host.replace(/\/+$/, "")
  const minTs = Date.now() - HISTORY_WINDOW_DAYS * 86_400_000
  const paid = new Set<string>()

  // TronGrid indexer endpoint, on the user's OWN provider host. No API key
  // (adding a Purser key would route identity through us — forbidden here).
  let url =
    `${base}/v1/accounts/${operator}/transactions/trc20` +
    `?only_from=true&contract_address=${USDT_ADDRESS}` +
    `&min_timestamp=${minTs}&limit=200`

  try {
    // Bound the walk so a very active wallet can't spin forever.
    for (let page = 0; page < 10 && url; page++) {
      const resp = await fetch(url, { signal })
      if (!resp.ok) return page === 0 ? null : paid // no indexer → degrade
      const json = (await resp.json()) as {
        data?: Array<{ to?: string; type?: string }>
        meta?: { links?: { next?: string } }
      }
      for (const t of json.data ?? []) {
        if (t.to && t.type === "Transfer") paid.add(t.to)
      }
      url = json.meta?.links?.next ?? ""
    }
    return paid
  } catch {
    // Aborted, offline, or a non-indexer host — degrade cleanly.
    return paid.size > 0 ? paid : null
  }
}

// --- ✓ activation: is the account real / used on-chain -----------------------

/** True if the account exists (activated) on-chain. getAccount returns {} for a
 *  never-used address. Reads through the user's own provider. Best-effort:
 *  any failure resolves false → the row stays "valid-format", never an error. */
async function isActivated(address: string): Promise<boolean> {
  const tw = getInjectedTronWeb()
  if (!tw) return false
  try {
    const acc = (await tw.trx.getAccount(address)) as unknown as Record<
      string,
      unknown
    >
    return Boolean(
      acc &&
        (acc.address != null ||
          acc.balance != null ||
          acc.create_time != null ||
          (Array.isArray(acc.assetV2) && acc.assetV2.length > 0))
    )
  } catch {
    return false
  }
}

/** Small concurrency limiter so activation checks don't burst the node. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      if (signal?.aborted) return
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Full on-chain verification for a roster, given the connected operator wallet.
 * - Starts from the offline structural levels.
 * - Marks paid-before (✓✓) from the single operator-history query.
 * - Marks valid (✓) for activated accounts not already ✓✓.
 * - Everything else stays valid-format.
 * Aborts cleanly via `signal` when the roster/account changes underneath it.
 */
export async function verifyAddresses(
  addresses: string[],
  operator: string | null,
  signal?: AbortSignal
): Promise<VerifyResult> {
  const unique = Array.from(new Set(addresses))
  const levels = structuralLevels(unique)

  // Pre-connect (or no operator): structural only, flagged degraded so the UI
  // knows ✓✓ hasn't run.
  if (!operator) return { levels, degraded: true }

  const host = providerHost()
  const validShape = unique.filter((a) => levels.get(a) !== "invalid")

  const recentlyPaid = await fetchRecentlyPaid(operator, host, signal)
  if (signal?.aborted) return { levels, degraded: recentlyPaid == null }

  // ✓✓ — matched locally; payee addresses never left the device.
  if (recentlyPaid) {
    for (const a of validShape) {
      if (recentlyPaid.has(a)) levels.set(a, "paid-before")
    }
  }

  // ✓ — activation for the rest. A ✓✓ address is already known-activated, skip.
  const needActivation = validShape.filter((a) => levels.get(a) !== "paid-before")
  const activated = await mapLimited(needActivation, 5, isActivated, signal)
  if (signal?.aborted) return { levels, degraded: recentlyPaid == null }
  needActivation.forEach((a, idx) => {
    if (activated[idx]) levels.set(a, "valid")
  })

  return { levels, degraded: recentlyPaid == null }
}
