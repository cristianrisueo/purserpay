import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type OnChangeFn,
  type RowSelectionState,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { Payee } from "@/lib/roster"
import type { BlockReason, TxState } from "@/hooks/usePayout"
import type { VerifyLevel } from "@/lib/tron/validation"

import { columns } from "./columns"

type PayoutTableProps = {
  data: Payee[]
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  paidIds: Set<string>
  paying: boolean
  connected: boolean
  wrongNetwork: boolean
  freeMode: boolean
  verifyByPayee: Map<string, VerifyLevel>
  rowBlocked: Map<string, BlockReason>
  rowOfacFlagged: Map<string, true>
  rowExchange: Map<string, string>
  rowFrozen: Map<string, true>
  rowUnverified: Set<string>
  rowChecking: Set<string>
  rowTxState: Map<string, TxState>
  txidByPayee: Map<string, string>
  payRow: (id: string) => void
  downloadReceipt: (id: string) => void
  updatePayee: (id: string, input: PayeeInput) => Promise<void>
  removePayee: (id: string) => Promise<void>
}

export function PayoutTable({
  data,
  rowSelection,
  onRowSelectionChange,
  paidIds,
  paying,
  connected,
  wrongNetwork,
  freeMode,
  verifyByPayee,
  rowBlocked,
  rowOfacFlagged,
  rowExchange,
  rowFrozen,
  rowUnverified,
  rowChecking,
  rowTxState,
  txidByPayee,
  payRow,
  downloadReceipt,
  updatePayee,
  removePayee,
}: PayoutTableProps) {
  const table = useReactTable({
    data,
    columns,
    state: { rowSelection },
    onRowSelectionChange,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      paidIds,
      paying,
      connected,
      wrongNetwork,
      freeMode,
      verifyByPayee,
      rowBlocked,
      rowOfacFlagged,
      rowExchange,
      rowFrozen,
      rowUnverified,
      rowChecking,
      rowTxState,
      txidByPayee,
      payRow,
      downloadReceipt,
      updatePayee,
      removePayee,
    },
  })

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(17,16,20,0.04),0_18px_40px_-30px_rgba(17,16,20,0.22)]">
      <div className="overflow-x-auto">
        <Table className="min-w-[740px]">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow
                key={group.id}
                className="border-border hover:bg-transparent"
              >
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-12 px-4 text-[12.5px] font-medium text-muted-foreground"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const paid = paidIds.has(row.original.id)
              const selected = row.getIsSelected()
              return (
                // Key on the paid state so a row RE-MOUNTS the instant it flips paid. Without this,
                // the green highlight (this inline className, read from the `paidIds` prop) updates on
                // pay success but the "Paid" status badge — read inside the TanStack cell via
                // `table.options.meta` — doesn't re-render on a meta-only change until a page reload
                // (the TanStack v8 mutable-meta gotcha). Re-keying forces the just-paid row's cells to
                // re-derive, so the badge and the green appear in the SAME render. Row selection lives
                // in TanStack (getRowId=row.id) and is untouched by the React key.
                <TableRow
                  key={`${row.id}:${paid ? "paid" : "open"}`}
                  className={cn(
                    "border-border transition-colors",
                    paid
                      ? "bg-success/[0.06] shadow-[inset_2px_0_0_var(--color-success)] hover:bg-success/[0.09]"
                      : selected
                        ? "hover:bg-muted/40"
                        : "opacity-55 hover:opacity-90 hover:bg-muted/30"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-4 py-3.5">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
