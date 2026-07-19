import type { ColumnDef, RowData } from "@tanstack/react-table"
import { Ban, FileText, Globe, HelpCircle, Landmark, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatUsdt, truncateAddress } from "@/lib/format"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { Payee } from "@/lib/roster"
import type { BlockReason, TxState } from "@/hooks/usePayout"
import { rowSecurityFor } from "@/lib/security/preflightView"
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
    /** free tier — the roster caps to ONE selected row; select-all is hidden. */
    freeMode: boolean
    /** address-verification level per payee id (✓ / ✓✓ / invalid). */
    verifyByPayee: Map<string, VerifyLevel>
    /** payees that can't be paid, with why (surfaced, never silently skipped). */
    rowBlocked: Map<string, BlockReason>
    /** payees whose address matched the OFAC list (advisory; pay-time gate blocks). */
    rowOfacFlagged: Map<string, true>
    /** payees whose address is a known exchange (advisory, amber; never blocks). Pure/always-live. */
    rowExchange: Map<string, string>
    /** payees whose destination is Tether-frozen (from the pay-time read; red, ALWAYS visible,
     *  blocks the row). A payment here would be trapped forever. */
    rowFrozen: Map<string, true>
    /** payees whose blacklist read failed/absent (D-7; muted, advisory, never green, never blocks). */
    rowUnverified: Set<string>
    /** true while the pay-time blacklist read is in flight (a neutral "checking" state per row). */
    preflightChecking: boolean
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
    header: ({ table }) =>
      // Free tier caps selection to one row, so a "select all" is meaningless.
      table.options.meta!.freeMode ? null : (
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
      const meta = table.options.meta!
      const id = row.original.id
      const level = meta.verifyByPayee.get(id) ?? "valid-format"
      const sanctioned = meta.rowOfacFlagged.has(id)
      // The frozen/exchange/unverified security state (S-3). `checking` is scoped to selected rows
      // so a whole-batch read doesn't paint an unrelated row "Checking…". Exchange is orthogonal
      // (pure/always-live) and renders as its own amber chip alongside the validation line.
      const sec = rowSecurityFor({
        frozen: meta.rowFrozen.has(id),
        unverified: meta.rowUnverified.has(id),
        checking: meta.preflightChecking && row.getIsSelected(),
        exchange: meta.rowExchange.get(id),
      })
      const chip =
        "inline-flex w-fit items-center gap-1 text-[11.5px] font-medium leading-none"
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <span
            title={row.original.address}
            className="font-mono text-[12.5px] text-muted-foreground"
          >
            {truncateAddress(row.original.address)}
          </span>
          {sanctioned ? (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
              Sanctioned — blocked
            </span>
          ) : sec.kind === "frozen" ? (
            // Frozen is a hard block — red, ALWAYS visible (never hover-only). It REPLACES the
            // validation line; the row's Pay is disabled and it must be removed to continue.
            <span
              className={cn(chip, "font-semibold text-destructive")}
              title="Tether has frozen this address; a payment would be trapped forever. Remove it to continue."
            >
              <Ban className="size-3.5" aria-hidden="true" />
              Frozen (Tether)
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <VerifyBadge level={level} />
              {sec.exchange ? (
                // Advisory only (amber) — does NOT replace the line, does NOT block. Honest about
                // partial coverage (S-2 GAP): "looks like" an exchange, credit policy unknown.
                <span
                  className={cn(chip, "text-warning")}
                  title="This looks like an exchange deposit address. Verify your exchange credits transfers from contracts, or the payee may not see the payment."
                >
                  <Landmark className="size-3.5" aria-hidden="true" />
                  Exchange?
                </span>
              ) : null}
              {sec.kind === "checking" ? (
                <span className={cn(chip, "text-muted-foreground")}>
                  <LoaderCircle
                    className="size-3 animate-spin"
                    aria-hidden="true"
                  />
                  Checking…
                </span>
              ) : sec.kind === "unverified" ? (
                // D-7 in the UI: couldn't confirm safe → neutral, never green, never blocking.
                <span
                  className={cn(chip, "text-muted-foreground")}
                  title="Couldn't verify this address right now — it'll be checked again on-chain when you pay."
                >
                  <HelpCircle className="size-3.5" aria-hidden="true" />
                  Unverified
                </span>
              ) : null}
            </div>
          )}
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
        Boolean(blocked) ||
        meta.rowOfacFlagged.has(id) ||
        // A Tether-frozen destination joins the "can't pay" set (a payment would be trapped).
        // The row is still removable; it can never reach a signature (see usePayout's guard).
        meta.rowFrozen.has(id)

      // Icon button (globe = opens the tx on the Tronscan website). The hover
      // title + aria-label carry the meaning; Slot forwards them onto the <a>.
      const tronscanButton = txid ? (
        <Button
          asChild
          variant="outline"
          size="icon-sm"
          title="See on Tronscan"
          aria-label="See on Tronscan"
        >
          <a href={txExplorerUrl(txid)} target="_blank" rel="noreferrer">
            <Globe aria-hidden="true" />
          </a>
        </Button>
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

      // Paid rows show two icon buttons side by side — a PDF-file icon (download
      // this payee's receipt) and a globe (see the tx on Tronscan); each carries
      // its meaning in a hover title. Non-paid rows keep the Pay action; a row
      // that already has a tx (confirming, or a broadcast that then failed) also
      // surfaces the Tronscan tracker so it can be inspected.
      return (
        <div className="flex items-center justify-end gap-2.5">
          {pill}
          {paid ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => meta.downloadReceipt(id)}
                title="Download PDF receipt"
                aria-label="Download PDF receipt"
              >
                <FileText aria-hidden="true" />
              </Button>
              {tronscanButton}
            </div>
          ) : (
            <>
              {tronscanButton}
              <Button
                variant="outline"
                size="sm"
                className="min-w-[52px]"
                disabled={payDisabled}
                onClick={() => meta.payRow(id)}
              >
                Pay
              </Button>
            </>
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
