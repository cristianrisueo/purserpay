"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RowSelectionState } from "@tanstack/react-table"
import { useLiveQuery } from "dexie-react-hooks"

import { storeBillingProfile, verifyRosterCompliance } from "@/app/actions/compliance"
import { db } from "@/lib/db"
import type { PayeeInput } from "@/lib/payeeValidation"
import {
  addPayee as addPayeeToDb,
  removePayee as removePayeeFromDb,
  replaceRoster,
  toPayee,
  updatePayee as updatePayeeInDb,
  type Payee,
} from "@/lib/roster"
import {
  addReceipt,
  advanceGreenCycle,
  greenSince as greenSinceOf,
  GREEN_SINCE_META_KEY,
  paidPayeeIds,
  txidForPayee,
} from "@/lib/receipts"
import { isTargetNetwork } from "@/lib/tron/client"
import { NETWORK } from "@/lib/tron/config"
import { toBaseUnits } from "@/lib/tron/amount"
import {
  getUsdtBalance,
  runDisperse,
  type DisperseRow,
} from "@/lib/tron/disperse"
import { humanize, PurserError } from "@/lib/tron/errors"
import {
  getSubscriptionStatus,
  runSubscribe,
} from "@/lib/tron/subscription"
import {
  structuralLevels,
  verifyAddresses,
  type VerifyLevel,
} from "@/lib/tron/validation"
import {
  getWalletProvider,
  type WalletAccount,
  type WalletProviderId,
} from "@/lib/tron/wallet"

/** Per-row live transaction state during a payout (distinct from the persisted
 *  "paid" green, which is derived from receipts). */
export type TxState = "signing" | "pending" | "confirmed" | "failed"

/** Why a selected row can't be paid — surfaced, never silently dropped. */
export type BlockReason = "address" | "amount"

/** The batch-level progress the controls read for their label/status. */
export type BatchPhase =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "signing"; index: number; total: number }
  | { kind: "confirming"; index: number; total: number }

/** The Subscribe flow's progress, for the paywall's button label. */
export type SubscribePhase =
  | "idle"
  | "storing"
  | "approving"
  | "signing"
  | "confirming"

/** The account holder's PII collected by the paywall. Sent straight to the
 *  server action and NEVER persisted client-side (no Dexie, no localStorage). */
export type BillingPii = { name: string; country: string; taxId: string }

function fmtBalance(units: bigint | null): number | null {
  if (units == null) return null
  // Display only — 6-dp USDT balances are well within a JS number's safe range.
  return Number(units) / 1_000_000
}

function withMapValue<V>(prev: Map<string, V>, ids: string[], value: V): Map<string, V> {
  const next = new Map(prev)
  for (const id of ids) next.set(id, value)
  return next
}

/**
 * The living-table state machine, now backed by real TRON. The roster and the
 * payout receipts are persisted (Dexie); wallet connection, verification, and
 * in-flight tx state are session-only. The 5 rules still hold — 1: all checked
 * by default · 2: uncheck never deletes · 3: green = PAID (now an on-chain
 * confirmation, not a timer) · 4: Reset clears the current green cycle · 5:
 * balance-aware lock. Plus the real double-check: ✓ valid on TRON, ✓✓ paid
 * before.
 */
export function usePayout() {
  const liveRows = useLiveQuery(() => db.payees.orderBy("order").toArray(), [])
  const livePayments = useLiveQuery(() => db.payments.toArray(), [])
  const liveGreenSince = useLiveQuery(() => db.meta.get(GREEN_SINCE_META_KEY), [])

  const isLoading = liveRows === undefined
  const roster = useMemo<Payee[]>(
    () => (liveRows ?? []).map(toPayee),
    [liveRows]
  )
  const isEmpty = !isLoading && roster.length === 0

  const payments = useMemo(() => livePayments ?? [], [livePayments])
  const since = greenSinceOf(liveGreenSince)
  const paidIds = useMemo(
    () => paidPayeeIds(payments, since),
    [payments, since]
  )

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // --- Wallet -------------------------------------------------------------
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [balanceUnits, setBalanceUnits] = useState<bigint | null>(null)
  const [host, setHost] = useState<string>("")
  const [walletError, setWalletError] = useState<PurserError | null>(null)
  const connected = account != null
  const wrongNetwork = connected && host !== "" && !isTargetNetwork(host)

  const refreshBalance = useCallback(async (address: string) => {
    try {
      setBalanceUnits(await getUsdtBalance(address))
    } catch {
      setBalanceUnits(null)
    }
  }, [])

  const connect = useCallback(
    async (providerId: WalletProviderId = "tronlink") => {
      setWalletError(null)
      try {
        const provider = getWalletProvider(providerId)
        const acc = await provider.connect()
        setAccount(acc)
        setHost(provider.getProviderHost())
        void refreshBalance(acc.address)
      } catch (e) {
        setWalletError(humanize(e))
      }
    },
    [refreshBalance]
  )

  const disconnect = useCallback(async () => {
    if (account) await getWalletProvider(account.providerId).disconnect()
    setAccount(null)
    setBalanceUnits(null)
    setHost("")
    setWalletError(null)
    // On-chain verification levels are cleared by the verify effect once
    // `account` becomes null.
  }, [account])

  // React to account/network changes coming from the wallet itself.
  useEffect(() => {
    if (!account) return
    const provider = getWalletProvider(account.providerId)
    return provider.onChange(() => {
      const addr = provider.getAddress()
      setHost(provider.getProviderHost())
      if (!addr) {
        // User disconnected/locked inside the wallet.
        setAccount(null)
        setBalanceUnits(null)
        return
      }
      if (addr !== account.address) {
        setAccount({ ...account, address: addr })
      }
      void refreshBalance(addr)
    })
  }, [account, refreshBalance])

  // --- Verification (✓ / ✓✓) ----------------------------------------------
  const addressesKey = useMemo(
    () => roster.map((p) => p.address).join("|"),
    [roster]
  )
  const [onchainLevels, setOnchainLevels] = useState<Map<string, VerifyLevel>>(
    new Map()
  )
  const [verifying, setVerifying] = useState(false)
  const [verifyDegraded, setVerifyDegraded] = useState(false)

  // Offline structural levels are instant and need no wallet — invalid rows are
  // flagged the moment a roster loads, before any connection.
  const structural = useMemo(
    () => structuralLevels(roster.map((p) => p.address)),
    [addressesKey] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (!account || roster.length === 0) {
      setOnchainLevels(new Map())
      setVerifyDegraded(false)
      return
    }
    const ctrl = new AbortController()
    setVerifying(true)
    verifyAddresses(
      roster.map((p) => p.address),
      account.address,
      ctrl.signal
    )
      .then((res) => {
        if (ctrl.signal.aborted) return
        setOnchainLevels(res.levels)
        setVerifyDegraded(res.degraded)
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setVerifying(false)
      })
    return () => ctrl.abort()
  }, [account, addressesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const levelFor = useCallback(
    (address: string): VerifyLevel =>
      onchainLevels.get(address) ?? structural.get(address) ?? "valid-format",
    [onchainLevels, structural]
  )

  const verifyByPayee = useMemo(() => {
    const m = new Map<string, VerifyLevel>()
    for (const p of roster) m.set(p.id, levelFor(p.address))
    return m
  }, [roster, levelFor])

  // A row is blocked (can't be paid, must be surfaced) if its address is invalid
  // or its amount can't be represented exactly in USDT base units.
  const rowBlocked = useMemo(() => {
    const m = new Map<string, BlockReason>()
    for (const p of roster) {
      if (levelFor(p.address) === "invalid") {
        m.set(p.id, "address")
        continue
      }
      try {
        toBaseUnits(p.amount)
      } catch {
        m.set(p.id, "amount")
      }
    }
    return m
  }, [roster, levelFor])

  // --- Rule 1 auto-check (unchanged behavior) -----------------------------
  const knownIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    const newIds = roster
      .filter((p) => !knownIds.current.has(p.id))
      .map((p) => p.id)
    roster.forEach((p) => knownIds.current.add(p.id))
    if (newIds.length === 0) return
    setRowSelection((prev) => {
      const next = { ...prev }
      newIds.forEach((id) => {
        next[id] = true
      })
      return next
    })
  }, [roster])

  // --- Selection / balance math (Rule 5, now exact base units) ------------
  const selected = useMemo(
    () => roster.filter((p) => rowSelection[p.id]),
    [roster, rowSelection]
  )
  const selectedSum = useMemo(
    () => selected.reduce((sum, p) => sum + p.amount, 0),
    [selected]
  )
  // Selected & not yet paid this cycle.
  const outstanding = useMemo(
    () => selected.filter((p) => !paidIds.has(p.id)),
    [selected, paidIds]
  )
  // Of those, the ones actually payable (valid address + representable amount).
  const payable = useMemo(
    () => outstanding.filter((p) => !rowBlocked.has(p.id)),
    [outstanding, rowBlocked]
  )
  const blockedCount = outstanding.length - payable.length

  const payableUnits = useMemo(() => {
    let total = 0n
    for (const p of payable) {
      try {
        total += toBaseUnits(p.amount)
      } catch {
        /* payable rows are convertible by construction */
      }
    }
    return total
  }, [payable])

  const shortfallUnits =
    balanceUnits == null ? 0n : payableUnits - balanceUnits
  const shortfall = shortfallUnits > 0n ? Number(shortfallUnits) / 1_000_000 : 0

  const allSelectedPaid = selected.length > 0 && outstanding.length === 0
  const anyPaid = paidIds.size > 0
  const balance = fmtBalance(balanceUnits)

  // --- Payout execution ----------------------------------------------------
  const [rowTxState, setRowTxState] = useState<Map<string, TxState>>(new Map())
  const [sessionTxid, setSessionTxid] = useState<Map<string, string>>(new Map())
  const [batchPhase, setBatchPhase] = useState<BatchPhase>({ kind: "idle" })
  const [payError, setPayError] = useState<PurserError | null>(null)
  const paying = batchPhase.kind !== "idle"

  // --- Subscription gate + OFAC screening ---------------------------------
  // The subscription is a FRONTEND paywall (disperse() is free on-chain); OFAC
  // screening runs server-side before any signature. Both are enforced inside
  // runPayment below, the single choke-point for every payout.
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(
    null
  )
  const [subscriptionChecking, setSubscriptionChecking] = useState(false)
  const [paywallOpen, setPaywallOpen] = useState(false)
  const [subscribePhase, setSubscribePhase] = useState<SubscribePhase>("idle")
  const [subscribeError, setSubscribeError] = useState<PurserError | null>(null)
  const [screening, setScreening] = useState(false)
  const [ofacFlagged, setOfacFlagged] = useState<string[] | null>(null)

  const refreshSubscription = useCallback(async (address: string) => {
    try {
      const s = await getSubscriptionStatus(address)
      setSubscriptionActive(s.active)
    } catch {
      setSubscriptionActive(false) // fail closed
    }
  }, [])

  // Read the on-chain subscription whenever a wallet is connected on the right
  // network. Fail-closed: any read failure leaves the gate "not active".
  useEffect(() => {
    if (!account || wrongNetwork) {
      setSubscriptionActive(null)
      return
    }
    let cancelled = false
    setSubscriptionChecking(true)
    getSubscriptionStatus(account.address)
      .then((s) => {
        if (!cancelled) setSubscriptionActive(s.active)
      })
      .catch(() => {
        if (!cancelled) setSubscriptionActive(false)
      })
      .finally(() => {
        if (!cancelled) setSubscriptionChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [account, wrongNetwork])

  // Rule 5 — never enable a pay that would revert or silently skip anyone.
  const canPayAll =
    connected &&
    !wrongNetwork &&
    !paying &&
    !screening &&
    payable.length > 0 &&
    blockedCount === 0 &&
    shortfallUnits <= 0n

  const runPayment = useCallback(
    async (rows: Payee[]) => {
      if (!account || rows.length === 0) return

      // Gate 1 — subscription (a frontend paywall). Without a confirmed-active
      // subscription, open the Subscribe dialog and stop: nothing is signed.
      // Fail-closed — anything but `true` (unknown / inactive / unreadable)
      // routes to the paywall, so the gate can never silently open.
      if (subscriptionActive !== true) {
        setPaywallOpen(true)
        return
      }

      setPayError(null)

      // Gate 2 — OFAC. Screen every recipient server-side before any signature.
      // A hit blocks the whole batch (atomic — never a partial workaround); a
      // throw fails CLOSED, because an unverifiable roster must never look clean.
      try {
        setScreening(true)
        const flagged = await verifyRosterCompliance(rows.map((r) => r.address))
        if (flagged.length > 0) {
          setOfacFlagged(flagged)
          return
        }
      } catch (e) {
        setPayError(
          new PurserError(
            "unknown",
            "Couldn't screen recipients against the sanctions list — nothing was sent. Try again in a moment.",
            e instanceof Error ? e.message : String(e)
          )
        )
        return
      } finally {
        setScreening(false)
      }

      // Gate 3 — disperse. Only reached when subscribed AND the roster is clean.
      const disperseRows: DisperseRow[] = rows.map((p) => ({
        id: p.id,
        address: p.address,
        amount: p.amount,
      }))
      try {
        await runDisperse(account.address, disperseRows, {
          onApproveStart: () => setBatchPhase({ kind: "approving" }),
          onBatchSigning: (index, total, rowIds) => {
            setBatchPhase({ kind: "signing", index, total })
            setRowTxState((prev) => withMapValue(prev, rowIds, "signing"))
          },
          onBatchPending: (index, total, txid, rowIds) => {
            setBatchPhase({ kind: "confirming", index, total })
            setRowTxState((prev) => withMapValue(prev, rowIds, "pending"))
            setSessionTxid((prev) => withMapValue(prev, rowIds, txid))
          },
          onBatchConfirmed: (batch) => {
            setRowTxState((prev) => withMapValue(prev, batch.rowIds, "confirmed"))
            // Persist the receipt → paidIds updates via live query → green.
            void addReceipt(batch).catch(() => {})
          },
          onBatchFailed: (_i, _t, rowIds, err) => {
            setRowTxState((prev) => withMapValue(prev, rowIds, "failed"))
            setPayError(err)
          },
        })
      } catch (e) {
        setPayError(humanize(e))
      } finally {
        setBatchPhase({ kind: "idle" })
        void refreshBalance(account.address)
      }
    },
    [account, subscriptionActive, refreshBalance]
  )

  const payAll = useCallback(() => {
    if (!canPayAll) return
    void runPayment(payable)
  }, [canPayAll, payable, runPayment])

  const payRow = useCallback(
    (id: string) => {
      if (!connected || wrongNetwork || paying || screening) return
      const p = roster.find((r) => r.id === id)
      if (!p || paidIds.has(id) || rowBlocked.has(id)) return
      // Single-row balance guard.
      try {
        if (balanceUnits != null && toBaseUnits(p.amount) > balanceUnits) return
      } catch {
        return
      }
      void runPayment([p])
    },
    [connected, wrongNetwork, paying, screening, roster, paidIds, rowBlocked, balanceUnits, runPayment]
  )

  // --- Subscription action -------------------------------------------------
  const subscribe = useCallback(
    async (pii: BillingPii) => {
      if (!account) return
      setSubscribeError(null)
      try {
        // 1) Persist the PII server-side, encrypted, keyed by a dissociated
        //    wallet hash. It goes straight to the server action — never Dexie,
        //    never localStorage.
        setSubscribePhase("storing")
        await storeBillingProfile(account.address, JSON.stringify(pii))
        // 2) Pay the subscription on-chain from the user's OWN wallet.
        await runSubscribe(account.address, {
          onApproveStart: () => setSubscribePhase("approving"),
          onSigning: () => setSubscribePhase("signing"),
          onConfirming: () => setSubscribePhase("confirming"),
        })
        // 3) Re-read the gate → active → close the paywall.
        await refreshSubscription(account.address)
        setPaywallOpen(false)
      } catch (e) {
        setSubscribeError(humanize(e))
      } finally {
        setSubscribePhase("idle")
      }
    },
    [account, refreshSubscription]
  )

  const dismissOfac = useCallback(() => setOfacFlagged(null), [])

  const reset = useCallback(async () => {
    // Advance the green cycle (keeps receipts) and clear session tx state.
    await advanceGreenCycle()
    setRowTxState(new Map())
    setSessionTxid(new Map())
    setPayError(null)
  }, [])

  // --- Tx-link map (session + persisted) ----------------------------------
  const txidByPayee = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of roster) {
      const session = sessionTxid.get(p.id)
      const persisted = txidForPayee(payments, p.id, since)
      const t = persisted ?? session
      if (t) m.set(p.id, t)
    }
    return m
  }, [roster, sessionTxid, payments, since])

  // --- Roster CRUD (unchanged, still Dexie) -------------------------------
  const forgetRow = useCallback((id: string) => {
    setRowSelection((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setRowTxState((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const addPayee = useCallback(async (input: PayeeInput) => {
    await addPayeeToDb(input)
  }, [])

  const updatePayee = useCallback(async (id: string, input: PayeeInput) => {
    await updatePayeeInDb(id, input)
  }, [])

  const removePayee = useCallback(
    async (id: string) => {
      await removePayeeFromDb(id)
      forgetRow(id)
    },
    [forgetRow]
  )

  const importRoster = useCallback(async (rows: PayeeInput[]) => {
    await replaceRoster(rows)
  }, [])

  return {
    roster,
    account,
    isLoading,
    isEmpty,
    // wallet
    connected,
    wrongNetwork,
    networkName: NETWORK.name,
    walletError,
    payError,
    // verification
    verifying,
    verifyDegraded,
    verifyByPayee,
    rowBlocked,
    // tx state
    rowTxState,
    txidByPayee,
    batchPhase,
    paying,
    // selection state
    rowSelection,
    setRowSelection,
    paidIds,
    // derived signals
    balance,
    selectedCount: selected.length,
    selectedSum,
    outstandingCount: outstanding.length,
    blockedCount,
    shortfall,
    allSelectedPaid,
    anyPaid,
    canPayAll,
    // subscription gate + OFAC
    subscriptionActive,
    subscriptionChecking,
    screening,
    paywallOpen,
    setPaywallOpen,
    subscribePhase,
    subscribeError,
    ofacFlagged,
    // actions
    connect,
    disconnect,
    reset,
    payRow,
    payAll,
    subscribe,
    dismissOfac,
    addPayee,
    updatePayee,
    removePayee,
    importRoster,
  }
}

export type PayoutController = ReturnType<typeof usePayout>
