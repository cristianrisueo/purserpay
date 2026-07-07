import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatUsdt } from "@/lib/format"
import type { PayeeInput } from "@/lib/payeeValidation"

import { AddPayeeButton } from "./AddPayeeButton"
import { ImportCsvDialog } from "./ImportCsvDialog"

type PayoutControlsProps = {
  connected: boolean
  selectedCount: number
  selectedSum: number
  outstandingCount: number
  shortfall: number
  allSelectedPaid: boolean
  anyPaid: boolean
  paying: boolean
  canPayAll: boolean
  rosterCount: number
  onAddPayee: (input: PayeeInput) => Promise<void>
  onImportRoster: (rows: PayeeInput[]) => Promise<void>
  onPayAll: () => void
  onReset: () => void
}

function statusLine({
  connected,
  selectedCount,
  outstandingCount,
  shortfall,
  allSelectedPaid,
}: Pick<
  PayoutControlsProps,
  "connected" | "selectedCount" | "outstandingCount" | "shortfall" | "allSelectedPaid"
>): { text: string; tone: "muted" | "warn" | "ready" | "done" } {
  if (!connected) return { text: "Connect your wallet to pay", tone: "muted" }
  if (selectedCount === 0)
    return { text: "Select at least one payee", tone: "muted" }
  if (allSelectedPaid)
    return { text: "Everyone selected has been paid", tone: "done" }
  if (shortfall > 0)
    return { text: `You're short ${formatUsdt(shortfall)} USDT`, tone: "warn" }
  return {
    text: `Balance covers all ${outstandingCount} selected`,
    tone: "ready",
  }
}

export function PayoutControls({
  connected,
  selectedCount,
  selectedSum,
  outstandingCount,
  shortfall,
  allSelectedPaid,
  anyPaid,
  paying,
  canPayAll,
  rosterCount,
  onAddPayee,
  onImportRoster,
  onPayAll,
  onReset,
}: PayoutControlsProps) {
  const status = statusLine({
    connected,
    selectedCount,
    outstandingCount,
    shortfall,
    allSelectedPaid,
  })
  const payLabel = paying ? "Signing…" : allSelectedPaid ? "All paid" : "Pay all"

  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold tabular-nums text-foreground">
          {selectedCount} selected
          <span className="text-muted-foreground"> · </span>
          {formatUsdt(selectedSum)} USDT
        </div>
        <div
          className={cn(
            "mt-1 text-[13px]",
            status.tone === "warn" && "font-medium text-destructive",
            status.tone === "done" && "font-medium text-success",
            status.tone === "ready" && "text-muted-foreground",
            status.tone === "muted" && "text-muted-foreground"
          )}
        >
          {status.text}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <ImportCsvDialog rosterCount={rosterCount} onImport={onImportRoster} />
        <AddPayeeButton onAdd={onAddPayee} variant="outline" collapseLabel />
        <Button
          variant="ghost"
          onClick={onReset}
          disabled={!anyPaid}
          className="h-auto rounded-[10px] px-4 py-3 text-[14px] font-medium"
        >
          Reset
        </Button>
        <Button
          onClick={onPayAll}
          disabled={!canPayAll}
          className="h-auto rounded-[11px] px-6 py-3 text-[15px] font-semibold shadow-[0_10px_26px_-14px_rgba(15,181,201,0.55)]"
        >
          {payLabel}
        </Button>
      </div>
    </div>
  )
}
