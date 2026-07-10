import { demoRecipients } from "./content"

// Module 03's visual: a completely static, non-animated preview of a finalized
// post-payout receipt — the state you land on after a batch confirms on-chain.
// No client state, no timers, no motion; mirrors the hero payout card's visual
// language. Purely decorative, safe to server-render.
const rows = demoRecipients.slice(0, 3)

export function ReceiptPreview() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(17,16,20,0.04),0_30px_60px_-34px_rgba(17,16,20,0.28)]">
      {/* header */}
      <div className="flex items-center justify-between border-b border-[#EFEDE9] px-5 py-[16px]">
        <div>
          <div className="text-[14.5px] font-semibold text-foreground">
            March receipt
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            confirmed on TRON · TRC20
          </div>
        </div>
        <span className="rounded-md bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
          ✓ on-chain
        </span>
      </div>

      {/* rows */}
      {rows.map((r) => (
        <div
          key={r.wallet}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#F3F1ED] px-5 py-[12px]"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-foreground">
              {r.name}
            </span>
            <span className="block truncate font-mono text-[10.5px] text-[#93908A]">
              {r.wallet}
            </span>
          </span>
          <span className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-foreground">
              {r.amount}
            </span>
            <span className="inline-flex min-w-[62px] justify-center rounded-full bg-success/10 px-2 py-1 text-[11px] font-semibold text-success">
              ✓ paid
            </span>
          </span>
        </div>
      ))}

      {/* footer — two decoupled actions: a distinct Tronscan link (left) and a
          Download PDF control (right). This mirrors the dashboard receipt model;
          on this static marketing preview the elements are representational (the
          demo hash isn't a real tx, and there's no batch to render into a PDF). */}
      <div className="flex items-center justify-between gap-3 bg-[#FCFBFA] px-5 py-[14px]">
        <span  className="truncate font-mono text-[11px] text-primary underline-offset-2 transition-colors"
        >
          TR7NHq…9kX2 · Tronscan
        </span>
        <span className="flex-none font-mono text-[11px] font-semibold text-primary">
          Download PDF
        </span>
      </div>
    </div>
  )
}
