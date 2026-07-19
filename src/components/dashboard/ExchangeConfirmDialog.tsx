import { Landmark } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { truncateAddress } from "@/lib/format"

type ExchangeRow = { address: string; exchange?: string }

type ExchangeConfirmDialogProps = {
  /** The exchange-looking rows in the batch; the dialog is open while this is non-null. */
  confirm: { rows: ExchangeRow[] } | null
  /** Sign the batch anyway (the operator accepts the disclaimer). */
  onConfirm: () => void
  /** Abandon — sign nothing. */
  onCancel: () => void
}

/**
 * The accept-and-pay step for exchange rows. The disclaimer lands HERE — at the moment of deciding,
 * right before the signature — not buried in a row tooltip. It is ADVISORY (amber, not a block):
 * unlike a frozen row, an exchange deposit CAN be paid, so this confirms rather than prevents.
 *
 * FROZEN rows never reach this step — their Pay is disabled and the pre-flight halts the batch
 * before it (usePayout.preflightThenPay). Honest wording: detection is partial (S-2 GAP), so we say
 * "looks like" and ask the operator to verify their exchange's crediting policy — never a promise.
 */
export function ExchangeConfirmDialog({
  confirm,
  onConfirm,
  onCancel,
}: ExchangeConfirmDialogProps) {
  const rows = confirm?.rows ?? []
  const count = rows.length
  const one = count === 1

  return (
    <AlertDialog
      open={confirm != null}
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warning/10 text-warning">
            <Landmark />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {one
              ? "A recipient looks like an exchange"
              : `${count} recipients look like exchanges`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {one ? "This address" : "These addresses"} match a known exchange deposit
            wallet. Verify your exchange credits transfers sent from a contract — some
            don&apos;t, and the payee may not see the payment. Nothing is signed until
            you continue.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {rows.map((r) => (
            <li
              key={r.address}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-warning/30 bg-warning/[0.06] px-3 py-2"
            >
              <span
                title={r.address}
                className="font-mono text-[12.5px] text-foreground"
              >
                {truncateAddress(r.address)}
              </span>
              {r.exchange ? (
                <span className="shrink-0 text-[11.5px] font-medium text-warning">
                  {r.exchange}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <AlertDialogFooter className="mx-0 mb-0 flex-row gap-2 border-t-0 bg-transparent p-0">
          <AlertDialogCancel className="flex-1" onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction className="flex-1" onClick={onConfirm}>
            Pay anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
