import { Ban, Check, CheckCheck, Landmark } from "lucide-react"

import { cn } from "@/lib/utils"
import { demoRecipients, demoTotal, type Recipient } from "./content"

// Static, faithful replica of the real PurserPay dashboard pre-flight (HERO-1). Every state, icon,
// token, and copy string below mirrors the LIVE dashboard (columns.tsx / VerifyBadge.tsx /
// PreflightBanner.tsx) so the hero promises nothing the app doesn't render: a Tether-frozen row
// (red, Pay disabled — the moat's showpiece), an exchange advisory (amber), a paid-before row
// (✓✓ green), and clean "Valid on TRON" rows (✓ aqua). GREEN = PAID only. No client state, no
// animation — a snapshot of the review state, safe to server-render.
//
// The frozen row is rendered UNCHECKED (an operator excludes a blocked row) so "Pay all" stays
// legitimately active over the three clean rows (blockedCount + the selected sum are computed over
// SELECTED rows in usePayout.ts). The "Before you pay" strip COMPOSITES every category the live
// PreflightBanner can produce into one showcase frame — the red frozen line first (severity:
// blocking > advisory), then the amber exchange advisory — each string verbatim from
// PreflightBanner.tsx. (The live banner is selected-only, so with the frozen row unchecked it would
// drop the red line; the hero deliberately shows it — the same "show every state at once" composite
// that already crams four row states into one card. The frozen row keeps its red inline badge too.)
export function HeroPayoutCard() {
  // Dynamic count straight from the roster mock, so the copy pluralizes exactly like the live
  // PreflightBanner (1 → "it", N → "them"). Today the roster carries a single frozen row (Aaron).
  const frozenCount = demoRecipients.filter((r) => r.line === "frozen").length

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(17,16,20,0.04),0_30px_60px_-34px_rgba(17,16,20,0.28)]">
      {/* "Before you pay" strip — copy verbatim from the dashboard PreflightBanner (incl. the app's
          phrasing + pluralization), so the mockup reads exactly what a real flagged batch shows. Both
          categories show by SEVERITY: the red frozen line first (blocking — the contract reverts), then
          the amber exchange advisory. The frozen row stays unchecked; the strip composites both banner
          states the app can produce into one showcase frame (see the header note). */}
      <div className="flex flex-col gap-2 border-b border-[#EFEDE9] px-5 py-4">
        <span className="text-[12.5px] font-semibold text-foreground">
          Before you pay:
        </span>
        {frozenCount > 0 ? (
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-destructive">
            <Ban className="mt-[1px] size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">
                {frozenCount} frozen by Tether
              </span>{" "}
              — paying {frozenCount === 1 ? "it" : "them"} would be an irreversible
              loss: the funds would not reach the recipient and can&apos;t be
              recovered. Remove {frozenCount === 1 ? "it" : "them"} to continue.
            </span>
          </p>
        ) : null}
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-warning">
          <Landmark className="mt-[1px] size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">
              1 look like exchange deposit address
            </span>{" "}
            — if the exchange doesn&apos;t credit transfers sent from a contract, the
            payee may not see the funds. Verify before paying.
          </span>
        </p>
      </div>

      {/* column headers — same fixed grid template as the rows so the independent grids align */}
      <div className="grid grid-cols-[18px_minmax(0,1fr)_56px_112px] items-center gap-x-2.5 border-b border-[#EFEDE9] bg-[#FCFBFA] px-5 py-2.5 text-[11px] font-medium text-muted-foreground">
        <span />
        <span>Payee</span>
        <span className="text-right">USDT</span>
        <span className="text-right">Status</span>
      </div>

      {/* rows */}
      {demoRecipients.map((r) => {
        const frozen = r.line === "frozen"
        return (
          <div
            key={r.wallet}
            className="grid grid-cols-[18px_minmax(0,1fr)_56px_112px] items-center gap-x-2.5 border-b border-[#F3F1ED] px-5 py-[13px]"
          >
            {/* checkbox: clean rows are selected (filled aqua ✓); the frozen row is left UNCHECKED
                (empty box) — the operator excludes a blocked row, so Pay all stays active. */}
            {frozen ? (
              <span className="size-[18px] rounded-[5px] border border-border bg-card" />
            ) : (
              <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-primary text-[11px] font-bold text-primary-foreground">
                ✓
              </span>
            )}

            {/* payee: name + truncated address + the single primary line (+ orthogonal exchange chip) */}
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[14px] font-semibold text-foreground">
                {r.name}
              </span>
              <span className="truncate font-mono text-[11px] text-[#93908A]">
                {r.wallet}
              </span>
              <RowLine line={r.line} exchange={r.exchange} />
            </span>

            {/* amount (plain USDT number, right-aligned — the "USDT" header carries the unit) */}
            <span className="text-right text-[13.5px] font-semibold tabular-nums text-foreground">
              {r.amount}
            </span>

            {/* status: Queued pill (hidden on the narrowest widths) + a Pay control, disabled on frozen */}
            <span className="flex items-center justify-end gap-1.5">
              <span className="hidden rounded-full bg-[#F4F2EF] px-2 py-0.5 text-[10.5px] font-medium text-[#93908A] sm:inline">
                ○ Queued
              </span>
              <span
                className={cn(
                  "rounded-[8px] border border-border px-2.5 py-1 text-[12px] font-medium",
                  frozen ? "text-muted-foreground opacity-50" : "text-foreground"
                )}
              >
                Pay
              </span>
            </span>
          </div>
        )
      })}

      {/* footer — the controls summary + a single Pay all, exactly as the dashboard renders it */}
      <div className="flex items-center justify-between gap-3 bg-[#FCFBFA] px-5 py-4">
        <span className="min-w-0 text-[13px] text-muted-foreground">
          <b className="text-foreground">3 selected</b> · {demoTotal} USDT
          <span className="mt-0.5 block text-[11.5px]">
            Balance covers all 3 selected
          </span>
        </span>
        <span className="inline-flex flex-none items-center gap-2 rounded-[10px] bg-primary px-5 py-[11px] text-[13.5px] font-semibold text-primary-foreground shadow-[0_1px_2px_rgba(17,16,20,0.06)]">
          Pay all
        </span>
      </div>
    </div>
  )
}

// The address cell's single primary line, mirroring VerifyBadge + the frozen block in columns.tsx.
// Frozen REPLACES the line (red, always visible); otherwise it's paid-before (✓✓ green) or valid
// (✓ aqua), with the amber Exchange? chip as an orthogonal advisory alongside a valid line.
function RowLine({ line, exchange }: { line: Recipient["line"]; exchange?: boolean }) {
  const base = "inline-flex items-center gap-1 text-[11px] font-medium leading-none"

  if (line === "frozen") {
    return (
      <span className={cn(base, "font-semibold text-destructive")}>
        <Ban className="size-3.5" aria-hidden="true" />
        Frozen (Tether)
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {line === "paid-before" ? (
        <span className={cn(base, "text-success")}>
          <CheckCheck className="size-3.5" aria-hidden="true" />
          Paid before
        </span>
      ) : (
        <span className={cn(base, "text-primary")}>
          <Check className="size-3.5" aria-hidden="true" />
          Valid on TRON
        </span>
      )}
      {exchange ? (
        <span className={cn(base, "text-warning")}>
          <Landmark className="size-3.5" aria-hidden="true" />
          Exchange?
        </span>
      ) : null}
    </span>
  )
}
