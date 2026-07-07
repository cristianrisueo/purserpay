import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RowSelectionState } from "@tanstack/react-table"

import { MOCK_BALANCE, MOCK_WALLET, mockRoster, type Payee } from "@/lib/mockRoster"

const STAGGER_MS = 220

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * The living-table state machine (Sprint 2, mock-fed). Owns row selection,
 * paid state, the mock wallet connection, and every derived signal the UI needs
 * — all real React state; only the chain and storage are faked. The 5 rules:
 *  1. all rows checked by default   2. uncheck never deletes
 *  3. green = paid                  4. reset clears greens
 *  5. balance-aware: lock Pay all + show the exact shortfall when short.
 */
export function usePayout() {
  // Rule 1 — everyone checked on load.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>(() =>
    Object.fromEntries(mockRoster.map((p) => [p.id, true]))
  )
  const [paidIds, setPaidIds] = useState<Set<string>>(() => new Set())
  const [paying, setPaying] = useState(false)
  const [connected, setConnected] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const balance = connected ? MOCK_BALANCE : null

  const selected = useMemo(
    () => mockRoster.filter((p) => rowSelection[p.id]),
    [rowSelection]
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

  return {
    roster: mockRoster as Payee[],
    wallet: MOCK_WALLET,
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
  }
}

export type PayoutController = ReturnType<typeof usePayout>
