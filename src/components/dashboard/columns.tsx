import type { ColumnDef, RowData } from "@tanstack/react-table"
import { ExternalLink, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatUsdt, truncateAddress } from "@/lib/format"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { Payee } from "@/lib/roster"
import type { BlockReason, TxState } from "@/hooks/usePayout"
import { txExplorerUrl } from "@/lib/tron/config"
import type { VerifyLevel } from "@/lib/tron/validation"

import { RosterRowActions } from "./RosterRowActions"
import { VerifyBadge } from "./VerifyBadge"

// Per-row app state the cells need, handed in via the table instance so the
// column defs stay pure. Updated fresh on every render of the table.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    paidIds: Set<string>
    paying: boolean
    connected: boolean
    wrongNetwork: boolean
    /** address-verification level per payee id (✓ / ✓✓ / invalid). */
    verifyByPayee: Map<string, VerifyLevel>
    /** payees that can't be paid, with why (surfaced, never silently skipped). */
    rowBlocked: Map<string, BlockReason>
    /** live tx state per payee id during a payout. */
    rowTxState: Map<string, TxState>
    /** tx hash per payee id (for the Tronscan link on a paid/pending row). */
    txidByPayee: Map<string, string>
    payRow: (id: string) => void
    /** Render + download a local PDF receipt for a paid row's batch. */
    downloadReceipt: (id: string) => void
    updatePayee: (id: string, input: PayeeInput) => Promise<void>
    removePayee: (id: string) => Promise<void>
  }
}

export const columns: ColumnDef<Payee>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? "indeterminate"
              : false
        }
        onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        aria-label="Select all payees"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Pay ${row.original.name}`}
      />
    ),
    enableSorting: false,
  },
  {
    accessorKey: "name",
    header: "Payee",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">
          {row.original.name}
        </div>
        <div className="truncate text-[12.5px] text-muted-foreground">
          {row.original.role}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "address",
    header: "Address",
    cell: ({ row, table }) => {
      const level = table.options.meta!.verifyByPayee.get(row.original.id) ?? "valid-format"
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <span
            title={row.original.address}
            className="font-mono text-[12.5px] text-muted-foreground"
          >
            {truncateAddress(row.original.address)}
          </span>
          <VerifyBadge level={level} />
        </div>
      )
    },
  },
  {
    accessorKey: "amount",
    header: () => <div className="text-right">USDT</div>,
    cell: ({ row, table }) => {
      const amountIssue = table.options.meta!.rowBlocked.get(row.original.id) === "amount"
      return (
        <div className="text-right">
          <div
            className={cn(
              "font-medium tabular-nums",
              amountIssue ? "text-destructive" : "text-foreground"
            )}
          >
            {formatUsdt(row.original.amount)}
          </div>
          {amountIssue && (
            <div className="text-[11px] font-medium text-destructive">
              Check amount
            </div>
          )}
        </div>
      )
    },
  },
  {
    id: "status",
    header: () => <div className="text-right">Status</div>,
    enableSorting: false,
    cell: ({ row, table }) => {
      const meta = table.options.meta!
      const id = row.original.id
      const paid = meta.paidIds.has(id)
      const tx = meta.rowTxState.get(id)
      const blocked = meta.rowBlocked.get(id)
      const txid = meta.txidByPayee.get(id)

      const payDisabled =
        paid ||
        !meta.connected ||
        meta.wrongNetwork ||
        meta.paying ||
        Boolean(blocked)

      const link = txid ? (
        <a
          href={txExplorerUrl(txid)}
          target="_blank"
          rel="noreferrer"
          title="View on Tronscan"
          className="text-primary transition-colors hover:text-primary/80"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null

      let pill
      if (paid) {
        pill = (
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11.5px] font-semibold text-success">
            ● Paid
          </span>
        )
      } else if (tx === "signing") {
        pill = (
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-medium text-foreground">
            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            Signing…
          </span>
        )
      } else if (tx === "pending") {
        pill = (
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11.5px] font-medium text-primary">
            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            Confirming…
          </span>
        )
      } else if (tx === "failed") {
        pill = (
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[11.5px] font-medium text-destructive">
            Not paid
          </span>
        )
      } else {
        pill = (
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
            ○ Queued
          </span>
        )
      }

      // Paid rows expose the two-action receipt model — the Tronscan tracker
      // link (above) and a dedicated Download PDF control — decoupled. Unpaid
      // rows keep the Pay action.
      return (
        <div className="flex items-center justify-end gap-2.5">
          {link}
          {pill}
          {paid ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => meta.downloadReceipt(id)}
              title="Download a PDF receipt for this payout"
            >
              Download PDF
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="min-w-[52px]"
              disabled={payDisabled}
              onClick={() => meta.payRow(id)}
            >
              Pay
            </Button>
          )}
        </div>
      )
    },
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    cell: ({ row, table }) => {
      const meta = table.options.meta!
      return (
        <RosterRowActions
          payee={row.original}
          disabled={meta.paying}
          onUpdate={meta.updatePayee}
          onRemove={meta.removePayee}
        />
      )
    },
  },
]
