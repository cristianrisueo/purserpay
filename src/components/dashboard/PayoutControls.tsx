import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatUsdt } from "@/lib/format"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { BatchPhase } from "@/hooks/usePayout"
import type { PurserError } from "@/lib/tron/errors"

import { AddPayeeButton } from "./AddPayeeButton"
import { ImportCsvDialog } from "./ImportCsvDialog"

type PayoutControlsProps = {
  connected: boolean
  wrongNetwork: boolean
  networkName: string
  selectedCount: number
  selectedSum: number
  outstandingCount: number
  blockedCount: number
  shortfall: number
  allSelectedPaid: boolean
  anyPaid: boolean
  paying: boolean
  verifying: boolean
  canPayAll: boolean
  /** Free tier — "Pay all" is locked; a Subscribe CTA takes its place. */
  freeMode: boolean
  batchPhase: BatchPhase
  payError: PurserError | null
  rosterCount: number
  onAddPayee: (input: PayeeInput) => Promise<void>
  onImportRoster: (rows: PayeeInput[]) => Promise<void>
  onPayAll: () => void
  onReset: () => void
  /** Opens the SubscribeDialog (runSubscribe, 150 USDT). */
  onSubscribe: () => void
}

type StatusTone = "muted" | "warn" | "ready" | "done"

function statusLine({
  connected,
  wrongNetwork,
  networkName,
  selectedCount,
  outstandingCount,
  blockedCount,
  shortfall,
  allSelectedPaid,
  verifying,
  freeMode,
}: Pick<
  PayoutControlsProps,
  | "connected"
  | "wrongNetwork"
  | "networkName"
  | "selectedCount"
  | "outstandingCount"
  | "blockedCount"
  | "shortfall"
  | "allSelectedPaid"
  | "verifying"
  | "freeMode"
>): { text: string; tone: StatusTone } {
  if (!connected) return { text: "Connect your wallet to pay", tone: "muted" }
  if (wrongNetwork)
    return { text: `Switch your wallet to ${networkName} to pay`, tone: "warn" }
  if (freeMode)
    return {
      text: "Free tier — pay any one payee below with its own Pay button",
      tone: "muted",
    }
  if (selectedCount === 0)
    return { text: "Select at least one payee", tone: "muted" }
  if (blockedCount > 0)
    return {
      text: `${blockedCount} ${blockedCount === 1 ? "row needs" : "rows need"} attention before paying`,
      tone: "warn",
    }
  if (allSelectedPaid)
    return { text: "Everyone selected has been paid", tone: "done" }
  if (shortfall > 0)
    return { text: `You're short ${formatUsdt(shortfall)} USDT`, tone: "warn" }
  if (verifying)
    return { text: "Checking addresses on TRON…", tone: "muted" }
  return {
    text: `Balance covers all ${outstandingCount} selected`,
    tone: "ready",
  }
}

function payingLabel(phase: BatchPhase): string {
  switch (phase.kind) {
    case "resetting":
      // Mainnet USDT needs a standing approval cleared to 0 before a new one — a
      // surprise second signature is a fear event (Law #2), so name it plainly.
      return "Clearing previous approval…"
    case "approving":
      return "Approving…"
    case "signing":
      return phase.total > 1
        ? `Signing ${phase.index + 1}/${phase.total}…`
        : "Waiting for signature…"
    case "confirming":
      return phase.total > 1
        ? `Confirming ${phase.index + 1}/${phase.total}…`
        : "Confirming on TRON…"
    default:
      return "Working…"
  }
}

export function PayoutControls({
  connected,
  wrongNetwork,
  networkName,
  selectedCount,
  selectedSum,
  outstandingCount,
  blockedCount,
  shortfall,
  allSelectedPaid,
  anyPaid,
  paying,
  verifying,
  canPayAll,
  freeMode,
  batchPhase,
  payError,
  rosterCount,
  onAddPayee,
  onImportRoster,
  onPayAll,
  onReset,
  onSubscribe,
}: PayoutControlsProps) {
  const status = statusLine({
    connected,
    wrongNetwork,
    networkName,
    selectedCount,
    outstandingCount,
    blockedCount,
    shortfall,
    allSelectedPaid,
    verifying,
    freeMode,
  })

  // While a payout is in flight, the live phase overrides the static status.
  const showProgress = paying
  const payLabel = paying
    ? payingLabel(batchPhase)
    : allSelectedPaid
      ? "All paid"
      : "Pay all"

  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold tabular-nums text-foreground">
          {selectedCount} selected
          <span className="text-muted-foreground"> · </span>
          {formatUsdt(selectedSum)} USDT
        </div>
        {showProgress ? (
          <div className="mt-1 text-[13px] font-medium text-primary">
            {batchPhase.kind === "resetting"
              ? "Clearing your previous approval first — one extra signature."
              : payLabel}
          </div>
        ) : payError ? (
          <div className="mt-1 text-[13px] font-medium text-destructive">
            {payError.message}
          </div>
        ) : (
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
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 sm:flex-nowrap">
        <ImportCsvDialog rosterCount={rosterCount} onImport={onImportRoster} />
        <AddPayeeButton onAdd={onAddPayee} variant="outline" collapseLabel />
        <Button
          variant="outline"
          onClick={onReset}
          disabled={!anyPaid || paying}
          className="h-auto rounded-[10px] px-4 py-3 text-[14px] font-medium"
        >
          Reset
        </Button>
        {freeMode ? (
          // Pay all is locked on the free tier — offer the upgrade instead of a
          // bare disabled button (Law of UX #2, zero fear).
          <Button
            onClick={onSubscribe}
            title="Subscribe to pay your whole roster in one signature"
            className="h-auto w-full rounded-[11px] px-6 py-3 text-[15px] font-semibold shadow-[0_8px_20px_-12px_rgba(15,181,201,0.4)] sm:w-auto"
          >
            Subscribe to pay all
          </Button>
        ) : (
          <Button
            onClick={onPayAll}
            disabled={!canPayAll}
            className="h-auto w-full rounded-[11px] px-6 py-3 text-[15px] font-semibold shadow-[0_8px_20px_-12px_rgba(15,181,201,0.4)] disabled:shadow-none sm:w-auto"
          >
            {payLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
