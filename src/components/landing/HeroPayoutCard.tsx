import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { demoRecipients, demoTotal } from "./content"

// Live product preview for the hero: a batch payout that pays everyone on one
// click. The green "paid" state is the owner-approved, reference-exact exception
// to the no-green-on-landing rule — scoped strictly to this card.
export function HeroPayoutCard() {
  const [paidSet, setPaidSet] = useState<Record<number, boolean>>({})
  const [paying, setPaying] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const allPaid = demoRecipients.every((_, i) => paidSet[i])
  const label = allPaid ? "All paid ✓" : paying ? "Signing…" : "Pay all"

  const payAll = () => {
    if (paying || allPaid) return
    setPaying(true)
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      setPaidSet(Object.fromEntries(demoRecipients.map((_, i) => [i, true])))
      return
    }
    demoRecipients.forEach((_, i) => {
      const t = setTimeout(
        () => setPaidSet((s) => ({ ...s, [i]: true })),
        240 * (i + 1)
      )
      timers.current.push(t)
    })
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(17,16,20,0.04),0_30px_60px_-34px_rgba(17,16,20,0.28)]">
      {/* header */}
      <div className="flex items-center justify-between border-b border-[#EFEDE9] px-5 py-[18px]">
        <div>
          <div className="text-[15px] font-semibold text-foreground">
            March payout
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            5 recipients · USDT (TRC20)
          </div>
        </div>
        <span className="rounded-md bg-bg-band px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {demoTotal}
        </span>
      </div>

      {/* rows */}
      {demoRecipients.map((r, i) => {
        const paid = !!paidSet[i]
        return (
          <div
            key={r.wallet}
            className="grid grid-cols-[22px_minmax(0,1fr)_auto_82px] items-center gap-3 border-b border-[#F3F1ED] px-5 py-[13px]"
          >
            <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-primary text-[11px] font-bold text-primary-foreground">
              ✓
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14.5px] font-semibold text-foreground">
                {r.name}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-[#93908A]">
                {r.role} · {r.wallet}
              </span>
            </span>
            <span className="text-right text-[14px] font-semibold text-foreground">
              {r.amount}
            </span>
            <span className="min-w-[74px] text-right">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]",
                  paid
                    ? "bg-success/10 font-semibold text-success"
                    : "bg-[#F4F2EF] font-medium text-[#93908A]"
                )}
              >
                {paid ? "● Paid" : "○ Ready"}
              </span>
            </span>
          </div>
        )
      })}

      {/* footer */}
      <div className="flex items-center justify-between gap-3 bg-[#FCFBFA] px-5 py-4">
        <span className="text-[13px] text-muted-foreground">
          5 selected · <b className="text-foreground">{demoTotal}</b>
        </span>
        <button
          type="button"
          onClick={payAll}
          disabled={paying || allPaid}
          className="inline-flex items-center gap-2 rounded-[9px] bg-primary px-5 py-[11px] text-[13.5px] font-semibold text-primary-foreground shadow-[0_1px_2px_rgba(17,16,20,0.06)] transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-100"
        >
          {label}
        </button>
      </div>
    </div>
  )
}
