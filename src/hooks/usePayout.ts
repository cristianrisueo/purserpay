"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table"
import { useLiveQuery } from "dexie-react-hooks"

import { storeBillingProfile, verifyRosterCompliance } from "@/app/actions/compliance"
import { authorizePayout, releasePayout } from "@/lib/freeTier/authorizeClient"
import { FREE_TIER_COOLDOWN_MS } from "@/lib/freeTier/gate"
import { proveWalletControl } from "@/lib/payout/challengeClient"
import {
  claimReferral,
  fetchReferralSummary,
  type ReferralSummaryResult,
} from "@/lib/referral/claimClient"
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
  paymentForPayee,
  txidForPayee,
} from "@/lib/receipts"
import { downloadReceiptPdf, downloadReportPdf } from "@/lib/receiptPdf"
import { isTargetNetwork } from "@/lib/tron/client"
import { NETWORK, txExplorerUrl, type SubscriptionPlan } from "@/lib/tron/config"
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

/** Credit-entitled = a free month is currently running OR banked months await. A
 *  banked-but-not-running wallet is entitled too: its next payout lazily consumes a
 *  month server-side. Reads the clock — call it from effects/handlers, never render. */
function creditEntitledFrom(s: ReferralSummaryResult): boolean {
  const running =
    s.creditActiveUntil != null &&
    new Date(s.creditActiveUntil).getTime() > Date.now()
  return running || s.monthsBanked > 0
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
  // True if there's at least one REPORTABLE payout on this network — a payment to a
  // payee still in the roster. Independent of the green cycle (Reset only advances
  // `since`, never deletes receipts), so the report survives a Reset; but gated on
  // roster membership so the "Download report" button hides (rather than producing an
  // empty PDF) once every paid payee has been removed. Mirrors downloadReport's filter.
  const hasPayments = useMemo(() => {
    const ids = new Set(roster.map((p) => p.id))
    return payments.some(
      (p) => p.network === NETWORK.key && p.recipients.some((r) => ids.has(r.id))
    )
  }, [payments, roster])

  const [rowSelection, setRowSelectionRaw] = useState<RowSelectionState>({})

  // In free mode the roster can have at most ONE selected row (radio behavior).
  // The table calls this setter; internal effects use setRowSelectionRaw directly
  // (they enforce the cap themselves where needed). Reads freeMode via a ref so it
  // always sees the latest without being re-created.
  const freeModeRef = useRef(false)
  const setRowSelection = useCallback<OnChangeFn<RowSelectionState>>((updater) => {
    setRowSelectionRaw((prev) => {
      const next =
        typeof updater === "function"
          ? (updater as (p: RowSelectionState) => RowSelectionState)(prev)
          : updater
      if (!freeModeRef.current) return next
      const prevOn = new Set(Object.keys(prev).filter((k) => prev[k]))
      const nextOn = Object.keys(next).filter((k) => next[k])
      if (nextOn.length <= 1) return next
      // Keep the newly-added id (radio); on a select-all, keep the first.
      const added = nextOn.filter((id) => !prevOn.has(id))
      const keep = added.length > 0 ? added[added.length - 1] : nextOn[0]
      return { [keep]: true }
    })
  }, [])

  // --- Wallet -------------------------------------------------------------
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [balanceUnits, setBalanceUnits] = useState<bigint | null>(null)
  const [host, setHost] = useState<string>("")
  const [walletError, setWalletError] = useState<PurserError | null>(null)
  // True once the mount-time wallet hydrate has run (whether or not it found an
  // authorized session) — lets the dashboard guard wait before acting on "no wallet".
  const [walletHydrated, setWalletHydrated] = useState(false)
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

  // Adopt an already-authorized wallet session on mount (no prompt), so arriving on
  // the dashboard with a wallet connected earlier (e.g. via the landing CTA) is
  // recognized without a fresh Connect click — required for the route guard and the
  // "Go to Dashboard" flow. Deferred to a microtask so the first render isn't mutated
  // synchronously and the injected wallet has a tick to appear.
  useEffect(() => {
    const provider = getWalletProvider("tronlink")
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      const addr = provider.getAddress()
      if (addr) {
        setAccount({
          providerId: "tronlink",
          provider: provider.label,
          address: addr,
        })
        setHost(provider.getProviderHost())
        void refreshBalance(addr)
      }
      setWalletHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [refreshBalance])

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

  // --- Roster-wide OFAC screen (the "value demo") -------------------------
  // Screen EVERY roster address server-side after any change and flag sanctioned
  // rows in the table — even in free mode, where only one row can ever be paid.
  // This is advisory UI only; the authoritative block still happens at pay time in
  // the authorize route (fail-closed). Screening needs no wallet (it's a server
  // action over salted hashes), so it runs regardless of connection.
  const [rowOfacFlagged, setRowOfacFlagged] = useState<Map<string, true>>(new Map())
  useEffect(() => {
    if (roster.length === 0) {
      setRowOfacFlagged(new Map())
      return
    }
    let cancelled = false
    verifyRosterCompliance(roster.map((p) => p.address))
      .then((flagged) => {
        if (cancelled) return
        const flaggedSet = new Set(flagged)
        const m = new Map<string, true>()
        for (const p of roster) if (flaggedSet.has(p.address)) m.set(p.id, true)
        setRowOfacFlagged(m)
      })
      .catch(() => {
        // Screening unavailable → clear advisory flags; the pay-time gate blocks.
        if (!cancelled) setRowOfacFlagged(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [addressesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Rule 1 auto-check (free-mode aware) --------------------------------
  const knownIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    const newIds = roster
      .filter((p) => !knownIds.current.has(p.id))
      .map((p) => p.id)
    roster.forEach((p) => knownIds.current.add(p.id))
    if (newIds.length === 0) return
    setRowSelectionRaw((prev) => {
      if (freeModeRef.current) {
        // Free mode: at most ONE selected. Keep an existing selection, else pick
        // the first newly-added row (the free action stays one click).
        if (Object.values(prev).some(Boolean)) return prev
        return { [newIds[0]]: true }
      }
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
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<
    number | null
  >(null)
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
      setSubscriptionExpiresAt(s.expiresAt)
    } catch {
      setSubscriptionActive(false) // fail closed
      setSubscriptionExpiresAt(null)
    }
  }, [])

  // Read the on-chain subscription whenever a wallet is connected on the right
  // network. Fail-closed: any read failure leaves the gate "not active".
  useEffect(() => {
    if (!account || wrongNetwork) {
      setSubscriptionActive(null)
      setSubscriptionExpiresAt(null)
      return
    }
    let cancelled = false
    setSubscriptionChecking(true)
    getSubscriptionStatus(account.address)
      .then((s) => {
        if (!cancelled) {
          setSubscriptionActive(s.active)
          setSubscriptionExpiresAt(s.expiresAt)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubscriptionActive(false)
          setSubscriptionExpiresAt(null)
        }
      })
      .finally(() => {
        if (!cancelled) setSubscriptionChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [account, wrongNetwork])

  // --- Referral credit + summary ------------------------------------------
  // Drives the dashboard referral card AND freeMode parity: a wallet holding or
  // running referral credit is entitled like a subscriber (the server would
  // authorize its whole roster), so it must NOT be shown the 1-payee free UI. The
  // server owns the balance; we only read it over our own route. creditEntitled is
  // null while unknown — including on a read failure — so we never wrongly cap a
  // paying customer; it's false only when the read definitively reports no credit.
  const [referral, setReferral] = useState<ReferralSummaryResult | null>(null)
  const [creditEntitled, setCreditEntitled] = useState<boolean | null>(null)

  const refreshReferral = useCallback(async (address: string) => {
    const s = await fetchReferralSummary(address)
    setReferral(s)
    setCreditEntitled(s ? creditEntitledFrom(s) : null)
  }, [])

  useEffect(() => {
    if (!account) {
      setReferral(null)
      setCreditEntitled(null)
      return
    }
    let cancelled = false
    void fetchReferralSummary(account.address).then((s) => {
      if (cancelled) return
      setReferral(s)
      setCreditEntitled(s ? creditEntitledFrom(s) : null)
    })
    return () => {
      cancelled = true
    }
  }, [account])

  // --- Free tier ----------------------------------------------------------
  // Free mode = connected on the right network with a DEFINITIVELY inactive
  // subscription (never `null`, which is the still-loading state — we don't cap
  // or nag until we know). One (1) payee every 30 days; the server is the
  // authority (see /api/payout/authorize), this flag only drives the UI.
  // Credit (running or banked) makes a wallet entitled like a subscriber, so it is
  // NOT free mode. creditEntitled must be DEFINITIVELY false (not null/unknown) to
  // cap — same "don't nag until we know" rule as the subscription read.
  const freeMode =
    connected &&
    !wrongNetwork &&
    subscriptionActive === false &&
    creditEntitled === false
  useEffect(() => {
    freeModeRef.current = freeMode
  }, [freeMode])

  // Entitled = active on-chain subscription OR referral credit. Drives the referral
  // card's visibility (a pure free-tier wallet sees the subscribe CTA, not the card).
  const entitled = subscriptionActive === true || creditEntitled === true

  // Cooldown end (ms) after a FREE_TIER_COOLDOWN from the server; drives the
  // banner's countdown. Only meaningful in free mode.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)

  // When free mode turns on after the roster already auto-checked everyone (the
  // subscription read resolves to "none" a beat later), collapse to a single
  // eligible row so the 1-payee cap holds. Idempotent — a ≤1 selection is left as is.
  useEffect(() => {
    if (!freeMode) return
    setRowSelectionRaw((prev) => {
      const ids = Object.keys(prev).filter((k) => prev[k])
      if (ids.length <= 1) return prev
      const keep = ids.find((id) => !paidIds.has(id) && !rowBlocked.has(id)) ?? ids[0]
      return { [keep]: true }
    })
  }, [freeMode, paidIds, rowBlocked])

  const openPaywall = useCallback(() => setPaywallOpen(true), [])

  // Rule 5 — never enable a pay that would revert or silently skip anyone. In free
  // mode "Pay all" is always locked (subscribe to pay the whole roster).
  const canPayAll =
    connected &&
    !wrongNetwork &&
    !freeMode &&
    !paying &&
    !screening &&
    payable.length > 0 &&
    blockedCount === 0 &&
    shortfallUnits <= 0n

  const runPayment = useCallback(
    async (rows: Payee[]) => {
      if (!account || rows.length === 0) return

      // Free-mode shortcut: a batch of more than one can never be a free payout —
      // go straight to the paywall, no round trip.
      if (freeModeRef.current && rows.length > 1) {
        setPaywallOpen(true)
        return
      }

      setPayError(null)
      setCooldownUntil(null)

      // GATE 0 — prove wallet control BEFORE any server state is touched: fetch a
      // single-use challenge and sign it (one wallet prompt, no funds move). The
      // server recovers the signer and asserts it equals the payer, so a spoofed
      // address can never consume this wallet's free slot or credit month. A
      // rejection / challenge failure fails CLOSED — sign nothing, consume nothing.
      let proof
      try {
        proof = await proveWalletControl(account.providerId, account.address)
      } catch (e) {
        setPayError(humanize(e))
        return
      }

      // ONE authorization round trip: proof + OFAC + server-side subscription read +
      // (for count === 1) the free-tier quota, consumed OPTIMISTICALLY here BEFORE
      // any broadcast. The server is the sole authority; a throw/NETWORK_ERROR
      // fails CLOSED (nothing is signed).
      setScreening(true)
      let authz
      try {
        authz = await authorizePayout(
          account.address,
          rows.map((r) => r.address),
          proof.nonce,
          proof.signature
        )
      } finally {
        setScreening(false)
      }

      if (!authz.ok) {
        switch (authz.code) {
          case "OFAC_BLOCKED":
            setOfacFlagged(authz.flagged)
            return
          case "FREE_TIER_BATCH_LIMIT":
            // Only reachable if a >1 batch slipped past the shortcut — nudge to subscribe.
            setPaywallOpen(true)
            return
          case "FREE_TIER_COOLDOWN":
            setCooldownUntil(new Date(authz.nextAvailableAt).getTime())
            return
          default:
            // SUBSCRIPTION_UNVERIFIABLE / SCREENING_UNAVAILABLE / NETWORK_ERROR /
            // BAD_REQUEST — all fail closed with a calm message; nothing was sent.
            setPayError(
              new PurserError(
                "unknown",
                "Couldn't authorize this payout — nothing was sent. Try again in a moment.",
                "message" in authz ? authz.message : authz.code
              )
            )
            return
        }
      }

      // Authorized. On the free path, remember the consumed slot so a failed/
      // rejected broadcast can restore it (so a mistake never burns the one free slot).
      const consumedAt = authz.mode === "free" ? authz.consumedAt : null
      let broadcastTxid: string | null = null

      const disperseRows: DisperseRow[] = rows.map((p) => ({
        id: p.id,
        address: p.address,
        amount: p.amount,
      }))
      let outcome: Awaited<ReturnType<typeof runDisperse>> | undefined
      try {
        outcome = await runDisperse(account.address, disperseRows, {
          onApproveStart: () => setBatchPhase({ kind: "approving" }),
          onBatchSigning: (index, total, rowIds) => {
            setBatchPhase({ kind: "signing", index, total })
            setRowTxState((prev) => withMapValue(prev, rowIds, "signing"))
          },
          onBatchPending: (index, total, txid, rowIds) => {
            broadcastTxid = txid
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

      // Free-tier bookkeeping. On success, flip the banner straight to the cooldown
      // countdown (the slot is now used for 30 days). On failure/rejection, ask the
      // server to restore the slot — it re-verifies the txid on-chain and refuses to
      // restore a payout that genuinely succeeded (never trusts this client claim).
      if (consumedAt) {
        const succeeded =
          outcome != null &&
          outcome.failure == null &&
          outcome.confirmed.length > 0
        if (succeeded) {
          setCooldownUntil(new Date(consumedAt).getTime() + FREE_TIER_COOLDOWN_MS)
        } else {
          void releasePayout(account.address, broadcastTxid, consumedAt)
        }
      }
    },
    [account, refreshBalance]
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
    async (pii: BillingPii, plan: SubscriptionPlan) => {
      if (!account) return
      setSubscribeError(null)
      try {
        // 1) Pay the subscription on-chain FIRST, from the user's OWN wallet. If this
        //    throws (rejected / no gas / revert) nothing is stored — no orphan PII for
        //    a non-subscriber. `plan` is chosen in the SubscribeDialog selector
        //    (0 = monthly / 1 = annual); the dashboard opens it on monthly by default.
        const { txid } = await runSubscribe(account.address, plan, {
          onApproveStart: () => setSubscribePhase("approving"),
          onSigning: () => setSubscribePhase("signing"),
          onConfirming: () => setSubscribePhase("confirming"),
        })
        // 2) Paid → persist the encrypted PII server-side, keyed by a dissociated wallet
        //    hash (straight to the server action — never Dexie, never localStorage).
        //    Best-effort: the payment already succeeded and the gate is on-chain, so a
        //    store failure must not block access or re-open the dialog (re-clicking would
        //    re-charge — runSubscribe isn't idempotent). Swallow + log.
        setSubscribePhase("storing")
        try {
          await storeBillingProfile(account.address, JSON.stringify(pii))
        } catch (storeErr) {
          console.error("PII store failed after a confirmed subscribe:", storeErr)
        }
        // 2b) Report the confirmed subscribe to the referral loop (best-effort): it
        //     marks this wallet a valid future referrer and, if it arrived via a
        //     referral link, banks the referrer a free month. Never blocks the paid
        //     user — the server reads the pp_ref cookie + re-verifies the txid itself.
        void claimReferral(account.address, txid)
        // 3) Re-read the gate → active → close the paywall; refresh the referral card.
        await refreshSubscription(account.address)
        void refreshReferral(account.address)
        setPaywallOpen(false)
      } catch (e) {
        setSubscribeError(humanize(e))
      } finally {
        setSubscribePhase("idle")
      }
    },
    [account, refreshSubscription, refreshReferral]
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

  // --- Receipt download (local print-to-PDF, read-only) -------------------
  // Finds the batch that paid this row in the current cycle and renders a
  // downloadable receipt for JUST this payee — a clean justificante to send to
  // that one person, not the whole batch. Purely local: reads IndexedDB, prints;
  // no chain call, no signing, no funds. The tx/date stay the batch's (the
  // on-chain proof is the batch tx); only the recipient list narrows to one.
  // Names come from the current roster (falling back to the address if a payee
  // was later removed).
  const downloadReceipt = useCallback(
    (payeeId: string) => {
      const payment = paymentForPayee(payments, payeeId, since)
      if (!payment) return
      const nameById = new Map(roster.map((p) => [p.id, p.name]))
      const mine = payment.recipients.filter((r) => r.id === payeeId)
      if (mine.length === 0) return
      downloadReceiptPdf({
        txid: payment.txid,
        explorerUrl: txExplorerUrl(payment.txid),
        networkName: NETWORK.name,
        timestamp: payment.timestamp,
        recipients: mine.map((r) => ({
          name: nameById.get(r.id) ?? r.address,
          address: r.address,
          amount: r.amount,
        })),
      })
    },
    [payments, since, roster]
  )

  // --- Full report download (local print-to-PDF, read-only) ---------------
  // Every paid recipient still in the roster, across every batch on this network,
  // newest first, each with its own date/time and Tronscan link. Full history —
  // ignores the green cycle (`since`) so a Reset never drops past payouts — but a
  // payee removed from the dashboard drops from the report too (its id is no longer
  // in `nameById`); their line and its amount are excluded rather than shown with the
  // raw address as a name. Same local-only promise as the per-row receipt: reads
  // IndexedDB, prints; no chain call, no funds.
  const downloadReport = useCallback(() => {
    const nameById = new Map(roster.map((p) => [p.id, p.name]))
    const lines = payments
      .filter((p) => p.network === NETWORK.key)
      .flatMap((p) =>
        p.recipients
          .filter((r) => nameById.has(r.id))
          .map((r) => ({
            timestamp: p.timestamp,
            name: nameById.get(r.id) ?? r.address,
            address: r.address,
            amount: r.amount,
            txid: p.txid,
            explorerUrl: txExplorerUrl(p.txid),
          }))
      )
      .sort((a, b) => b.timestamp - a.timestamp)
    if (lines.length === 0) return
    downloadReportPdf({
      networkName: NETWORK.name,
      generatedAt: Date.now(),
      lines,
    })
  }, [payments, roster])

  // --- Delete all local data (user-initiated device-local wipe) -----------
  // Clears the ENTIRE local database — the roster, the full payment history, and the
  // green-cycle meta — plus the session-only tx/selection state. Device-local only
  // (Dexie): the account's encrypted PII (Supabase) and the on-chain subscription are
  // untouched. The live queries repaint the dashboard to its empty state afterward.
  const deleteAllData = useCallback(async () => {
    await Promise.all([db.payees.clear(), db.payments.clear(), db.meta.clear()])
    knownIds.current = new Set()
    setRowSelectionRaw({})
    setRowTxState(new Map())
    setSessionTxid(new Map())
    setPayError(null)
  }, [])

  // --- Roster CRUD (unchanged, still Dexie) -------------------------------
  const forgetRow = useCallback((id: string) => {
    setRowSelectionRaw((prev) => {
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
    walletHydrated,
    wrongNetwork,
    networkName: NETWORK.name,
    walletError,
    payError,
    // verification
    verifying,
    verifyDegraded,
    verifyByPayee,
    rowBlocked,
    rowOfacFlagged,
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
    hasPayments,
    canPayAll,
    // subscription gate + OFAC
    subscriptionActive,
    subscriptionExpiresAt,
    subscriptionChecking,
    screening,
    paywallOpen,
    setPaywallOpen,
    subscribePhase,
    subscribeError,
    ofacFlagged,
    // free tier
    freeMode,
    cooldownUntil,
    openPaywall,
    // referral (credit + share)
    entitled,
    referralEnabled: referral?.enabled ?? false,
    referralCode: referral?.code ?? null,
    referralMonthsBanked: referral?.monthsBanked ?? 0,
    referralQualified: referral?.qualifiedReferrals ?? 0,
    referralCreditActiveUntil: referral?.creditActiveUntil ?? null,
    // actions
    connect,
    disconnect,
    reset,
    payRow,
    payAll,
    downloadReceipt,
    downloadReport,
    deleteAllData,
    subscribe,
    dismissOfac,
    addPayee,
    updatePayee,
    removePayee,
    importRoster,
  }
}

export type PayoutController = ReturnType<typeof usePayout>
