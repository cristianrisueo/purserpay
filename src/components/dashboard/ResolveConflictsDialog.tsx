import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatUsdt, truncateAddress } from "@/lib/format"
import type { PayeeInput } from "@/lib/payeeValidation"
import {
  resolveConflictPicks,
  type ConflictSelection,
  type RowConflictGroup,
} from "@/lib/rosterDedupe"
import { cn } from "@/lib/utils"

type ResolveConflictsDialogProps = {
  /** The shared-address conflicts from the just-run import; the dialog is open while this
   *  is non-null and non-empty. The uniques are ALREADY in the roster by this point. */
  groups: RowConflictGroup<PayeeInput>[] | null
  /** Import the rows the user chose to keep (may be empty — nothing is chosen by default). */
  onResolve: (picks: PayeeInput[]) => Promise<void>
  /** Dismissed without finishing → S-0 fallback: uniques stay imported, conflicts unimported. */
  onCancel: () => void
}

/**
 * The interactive, git-diff-style duplicate resolver (UX-3). When a CSV import shares an address
 * across rows, the uniques import immediately and the competing rows land HERE, side by side, so the
 * operator picks which one to keep IN-APP instead of re-editing their spreadsheet.
 *
 * The retain-not-discard rule is unchanged: NOTHING is chosen for you (no auto-pick). A group left
 * unresolved — or explicitly "Discard all" — imports NEITHER row (exactly S-0). Only a row the user
 * clicks is added, via the same uniqueness-guarded add path as a manual add.
 *
 * Lives at the Dashboard root (not inside ImportCsvDialog) because importing the uniques flips the
 * roster to non-empty, which unmounts the EmptyRoster that hosts the import dialog — this resolver
 * must outlive that swap, so it is driven by usePayout state like ExchangeConfirmDialog.
 */
export function ResolveConflictsDialog({
  groups,
  onResolve,
  onCancel,
}: ResolveConflictsDialogProps) {
  const open = groups != null && groups.length > 0

  // Per-group choice, keyed by the shared address (unique across groups). Absent = unresolved.
  const [selections, setSelections] = useState<
    Record<string, ConflictSelection | undefined>
  >({})
  const [busy, setBusy] = useState(false)

  // A fresh import (a new `groups` reference) → a fresh, empty slate: nothing is chosen for you,
  // even if a later import happens to share an address with a prior one. This is the React-endorsed
  // "adjust state during render when a prop changes" pattern (no effect, no cascading render).
  const [seenGroups, setSeenGroups] = useState(groups)
  if (groups !== seenGroups) {
    setSeenGroups(groups)
    setSelections({})
  }

  function choose(address: string, selection: ConflictSelection) {
    setSelections((prev) => ({ ...prev, [address]: selection }))
  }

  function handleOpenChange(next: boolean) {
    // `busy` = a Keep is committing; the close it triggers is NOT a user dismiss, so don't fire the
    // S-0 cancel fallback (which would be a harmless no-op anyway — the picks are already added).
    if (next || busy) return
    onCancel()
  }

  async function handleKeep() {
    if (!groups) return
    const picks = resolveConflictPicks(groups, selections)
    setBusy(true)
    try {
      await onResolve(picks)
    } finally {
      setBusy(false)
    }
  }

  const activeGroups = groups ?? []
  const keepCount = activeGroups.reduce(
    (n, g) => (typeof selections[g.address] === "number" ? n + 1 : n),
    0
  )
  const one = activeGroups.length === 1

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resolve duplicate addresses</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {one ? "One address appears" : `${activeGroups.length} addresses appear`}{" "}
            on more than one row in your file. Pick the one row to keep for each — the
            others won&apos;t be imported. Nothing is chosen for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {activeGroups.map((group) => {
            const selection = selections[group.address]
            const discarded = selection === "discard"
            return (
              <div
                key={group.address}
                className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-muted/20 p-3.5"
              >
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="font-medium text-foreground">Shared address</span>
                  <span
                    title={group.address}
                    className="font-mono text-muted-foreground"
                  >
                    {truncateAddress(group.address)}
                  </span>
                </div>

                <div
                  role="radiogroup"
                  aria-label={`Which row to keep for ${truncateAddress(group.address)}`}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {group.candidates.map((candidate, index) => {
                    const selected = selection === index
                    return (
                      <button
                        key={index}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => choose(group.address, index)}
                        className={cn(
                          "flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/[0.04] ring-1 ring-primary"
                            : "border-border hover:border-primary/40"
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[14px] font-medium text-foreground">
                            {candidate.row.name}
                          </span>
                          <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                            {formatUsdt(candidate.row.amount)} USDT
                          </span>
                        </div>
                        {candidate.row.role ? (
                          <span className="truncate text-[12.5px] text-muted-foreground">
                            {candidate.row.role}
                          </span>
                        ) : null}
                        <span className="text-[11.5px] text-muted-foreground">
                          Row {candidate.rowNumber}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  role="radio"
                  aria-checked={discarded}
                  onClick={() => choose(group.address, "discard")}
                  className={cn(
                    "self-start rounded-[8px] px-1 text-[12.5px] transition-colors",
                    discarded
                      ? "font-medium text-foreground underline underline-offset-2"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Discard all — import none of these
                </button>
              </div>
            )
          })}
        </div>

        <DialogFooter className="flex-row gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" className="flex-1" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            className="flex-1"
            disabled={busy}
            onClick={handleKeep}
          >
            {keepCount > 0
              ? `Keep ${keepCount} selected`
              : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
