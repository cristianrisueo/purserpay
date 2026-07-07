import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RowSelectionState } from "@tanstack/react-table"
import { useLiveQuery } from "dexie-react-hooks"

import { db } from "@/lib/db"
import { MOCK_BALANCE, MOCK_WALLET } from "@/lib/mockRoster"
import type { PayeeInput } from "@/lib/payeeValidation"
import {
  addPayee as addPayeeToDb,
  removePayee as removePayeeFromDb,
  replaceRoster,
  toPayee,
  updatePayee as updatePayeeInDb,
  type Payee,
} from "@/lib/roster"

const STAGGER_MS = 220

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * The living-table state machine, now Dexie-backed. Owns row selection, paid
 * state (both ephemeral, session-only), the mock wallet connection, and every
 * derived signal the UI needs. The roster itself is real, persisted data. The
 * 5 rules:
 *  1. all rows checked by default   2. uncheck never deletes
 *  3. green = paid                  4. reset clears greens
 *  5. balance-aware: lock Pay all + show the exact shortfall when short.
 */
export function usePayout() {
  const liveRows = useLiveQuery(() => db.payees.orderBy("order").toArray(), [])
  const isLoading = liveRows === undefined
  const roster = useMemo<Payee[]>(
    () => (liveRows ?? []).map(toPayee),
    [liveRows]
  )
  const isEmpty = !isLoading && roster.length === 0

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [paidIds, setPaidIds] = useState<Set<string>>(() => new Set())
  const [paying, setPaying] = useState(false)
  const [connected, setConnected] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  // Rule 1 over live data — auto-check any row id not yet seen this mount.
  // Covers first load (everything unseen → all checked), a CSV overwrite
  // (every row gets a fresh UUID → all unseen → all checked), and adding one
  // payee (only the new id is unseen; everyone else's toggle is untouched).
  const knownIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    // Compute which ids are new and mutate the ref here, in the effect body —
    // NOT inside the setState updater below. React (in Strict Mode) invokes
    // state updater functions twice to check they're pure; a ref mutation
    // inside the updater would be "seen" by the second invocation, making it
    // think those ids were already known and silently drop the check.
    const newIds = roster.filter((p) => !knownIds.current.has(p.id)).map((p) => p.id)
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

  const balance = connected ? MOCK_BALANCE : null

  const selected = useMemo(
    () => roster.filter((p) => rowSelection[p.id]),
    [roster, rowSelection]
  )
  const selectedSum = useMemo(
    () => selected.reduce((sum, p) => sum + p.amount, 0),
    [selected]
  )
  // The rows Pay all would still move: checked and not yet paid.
  const outstanding = useMemo(
    () => selected.filter((p) => !paidIds.has(p.id)),
    [selected, paidIds]
  )
  const outstandingSum = useMemo(
    () => outstanding.reduce((sum, p) => sum + p.amount, 0),
    [outstanding]
  )

  const shortfall = balance == null ? 0 : outstandingSum - balance
  const allSelectedPaid = selected.length > 0 && outstanding.length === 0
  const anyPaid = paidIds.size > 0
  // Rule 5 — never enable a pay that would revert.
  const canPayAll =
    connected && outstanding.length > 0 && shortfall <= 0 && !paying

  const connect = useCallback(() => setConnected((c) => !c), [])

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setPaidIds(new Set())
    setPaying(false)
  }, [])

  const markPaid = useCallback((ids: string[]) => {
    setPaidIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
  }, [])

  // Per-row pay — the exceptional single payout, not the star.
  const payRow = useCallback(
    (id: string) => {
      if (!connected || paidIds.has(id)) return
      markPaid([id])
    },
    [connected, paidIds, markPaid]
  )

  const payAll = useCallback(() => {
    if (!canPayAll) return
    const queue = outstanding
    setPaying(true)

    if (prefersReducedMotion()) {
      markPaid(queue.map((p) => p.id))
      setPaying(false)
      return
    }

    queue.forEach((p, i) => {
      const t = setTimeout(() => {
        markPaid([p.id])
        if (i === queue.length - 1) setPaying(false)
      }, STAGGER_MS * (i + 1))
      timers.current.push(t)
    })
  }, [canPayAll, outstanding, markPaid])

  const forgetRow = useCallback((id: string) => {
    setRowSelection((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setPaidIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
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
    wallet: MOCK_WALLET,
    isLoading,
    isEmpty,
    // state
    rowSelection,
    setRowSelection,
    paidIds,
    paying,
    connected,
    // derived signals
    balance,
    selectedCount: selected.length,
    selectedSum,
    outstandingCount: outstanding.length,
    shortfall,
    allSelectedPaid,
    anyPaid,
    canPayAll,
    // actions
    connect,
    reset,
    payRow,
    payAll,
    addPayee,
    updatePayee,
    removePayee,
    importRoster,
  }
}

export type PayoutController = ReturnType<typeof usePayout>
