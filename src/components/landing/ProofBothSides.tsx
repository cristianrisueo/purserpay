import {
  ArrowUpRight,
  CheckCheck,
  Copy,
  Download,
  FileText,
  Globe,
  Share2,
  ShieldCheck,
} from "lucide-react"

import { proofAgencyRows, proofPayeeReceipts } from "./content"

// Module 03's visual (#how — "The same proof, on both sides"): the SAME confirmed payout shown
// two ways — the agency's dashboard post-pay state (What you see) and the payee's /portal receipts
// (What your payees see). Two compact, STATIC, stacked cards, each faithful to the live app
// (dashboard columns.tsx + PortalLinkButton; portal AffiliatePortal.tsx) so the block promises
// nothing the product doesn't render. GREEN = PAID only — every green mark here is a genuinely paid
// state (● Paid, ✓✓ Paid before). No client state, no timers, no motion — safe to server-render.
// The two cards sit side by side on desktop and stack on narrow screens; the copy lives above them
// (Module 03 uses the full-width stacked layout in Modules.tsx, not the 50/50 shell).
export function ProofBothSides() {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-7">
      <figure className="m-0">
        <figcaption className="mb-2.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
          What you see
        </figcaption>
        <AgencyCard />
      </figure>

      <figure className="m-0">
        <figcaption className="mb-2.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
          What your payees see
        </figcaption>
        <PayeeCard />
      </figure>
    </div>
  )
}

const cardShell =
  "overflow-hidden rounded-[12px] border border-border bg-card shadow-[0_1px_2px_rgba(17,16,20,0.04),0_18px_40px_-30px_rgba(17,16,20,0.22)]"

// The agency's dashboard the moment a batch has cleared: a "Payout" header with an All-paid chip,
// each recipient shown Paid (green) with a ✓✓ Paid-before line + the receipt (PDF) and globe
// (Tronscan) icons, and the two record actions in the footer. Mirrors columns.tsx +
// PortalLinkButton; the destructive "Delete data" control is deliberately omitted (owner).
function AgencyCard() {
  return (
    <div className={cardShell}>
      <div className="flex items-center justify-between border-b border-[#EFEDE9] px-4 py-3">
        <span className="text-[13.5px] font-semibold text-foreground">
          Payout · July 2026
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">
          <span aria-hidden="true">●</span> All paid
        </span>
      </div>

      {proofAgencyRows.map((r) => (
        <div
          key={r.wallet}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#F3F1ED] px-4 py-2.5"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {r.name}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[#93908A]">
              {r.wallet}
            </span>
            <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-success">
              <CheckCheck className="size-3" aria-hidden="true" />
              Paid before
            </span>
          </span>

          <span className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tabular-nums text-foreground">
              {r.amount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-semibold text-success">
              <span aria-hidden="true">●</span> Paid
            </span>
            <span className="flex items-center gap-1 text-[#93908A]">
              <FileText className="size-3.5" aria-hidden="true" />
              <Globe className="size-3.5" aria-hidden="true" />
            </span>
          </span>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3 bg-[#FCFBFA] px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
          <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Payment link for your payees
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
          <Download className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Download report
        </span>
      </div>
    </div>
  )
}

// The same payout seen from the payee's /portal: their own signed-in receipts list. The sub is the
// verbatim no-custody assurance from AffiliatePortal.tsx; each row carries the real per-row actions
// (PDF = download proof, Share = flex card, Verify = open on Tronscan). Amounts are ONE payee's
// history across months (coherent hundreds/thousands), not this single batch.
function PayeeCard() {
  return (
    <div className={cardShell}>
      <div className="border-b border-[#EFEDE9] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          <span className="text-[13.5px] font-semibold text-foreground">
            Your PurserPay receipts
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-[1.5] text-muted-foreground">
          Signing only proves the wallet is yours — it authorizes no payment and moves no funds.
        </p>
      </div>

      <div className="border-b border-[#F3F1ED] bg-[#FCFBFA] px-4 py-2 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
        3 PAYMENTS RECEIVED
      </div>

      {proofPayeeReceipts.map((r) => (
        <div
          key={r.date}
          className="flex items-center justify-between gap-3 border-b border-[#F3F1ED] px-4 py-2.5"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-foreground">
              {r.amount} USDT
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[#93908A]">
              From {r.from} · {r.date} UTC
            </span>
          </span>

          <span className="flex flex-none items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-2 py-1 text-[10.5px] font-semibold text-primary-foreground">
              <Download className="size-3" aria-hidden="true" />
              PDF
            </span>
            <span className="inline-flex items-center gap-1 rounded-[7px] border border-border px-2 py-1 text-[10.5px] font-medium text-foreground">
              <Share2 className="size-3" aria-hidden="true" />
              Share
            </span>
            <span className="inline-flex items-center gap-1 rounded-[7px] border border-border px-2 py-1 text-[10.5px] font-medium text-foreground">
              Verify
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </span>
          </span>
        </div>
      ))}

      <div className="bg-[#FCFBFA] px-4 py-3 text-[10.5px] leading-[1.5] text-muted-foreground">
        Every row is a real disperse from PurserPay&rsquo;s payout contract.
      </div>
    </div>
  )
}
