import type { ColumnDef, RowData } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatUsdt, truncateAddress } from "@/lib/format"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { Payee } from "@/lib/roster"

import { RosterRowActions } from "./RosterRowActions"

// Per-row app state the cells need, handed in via the table instance so the
// column defs stay pure. Updated fresh on every render of the table.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    paidIds: Set<string>
    paying: boolean
    connected: boolean
    payRow: (id: string) => void
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
    cell: ({ row }) => (
      <span
        title={row.original.address}
        className="font-mono text-[12.5px] text-muted-foreground"
      >
        {truncateAddress(row.original.address)}
      </span>
    ),
  },
  {
    accessorKey: "amount",
    header: () => <div className="text-right">USDT</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums text-foreground">
        {formatUsdt(row.original.amount)}
      </div>
    ),
  },
  {
    id: "status",
    header: () => <div className="text-right">Status</div>,
    enableSorting: false,
    cell: ({ row, table }) => {
      const meta = table.options.meta!
      const paid = meta.paidIds.has(row.original.id)

      return (
        <div className="flex items-center justify-end gap-3">
          <span
            className={cn(
              "inline-flex w-[84px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]",
              paid
                ? "bg-success/10 font-semibold text-success"
                : "bg-muted font-medium text-muted-foreground"
            )}
          >
            {paid ? "● Paid" : "○ Queued"}
          </span>

          <Button
            variant="outline"
            size="sm"
            className="min-w-[52px]"
            disabled={paid || !meta.connected || meta.paying}
            onClick={() => meta.payRow(row.original.id)}
          >
            {paid ? "Done" : "Pay"}
          </Button>
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
