import Link from "next/link"
import { ArrowUpRight, CheckCircle2, ShieldAlert } from "lucide-react"

import { formatUsdtAmount, formatUtcDate, shortWallet } from "@/lib/affiliate/format"
import { verifyReceipt } from "@/lib/affiliate/verify"
import { NETWORK, txExplorerUrl } from "@/lib/tron/config"

// /verify/[txid]?a=<auditId> — the PUBLIC, read-only verification page behind the QR
// on a 1B receipt PDF (docs/09 §5). No wallet, no signature, no cookies.
//
// THE ANTI-PHOTOSHOP ANCHOR (D4): it resolves (txid, auditId) → the batch facts from
// the CHAIN-DERIVED index (verify_receipt reads disperse_receipts, populated by
// verifyDisperseTx from on-chain calldata) — the amount here is NEVER a query
// parameter. So a payee who hand-edits the amount on their PDF is exposed: this page
// shows the real amount, and the Tronscan link lets anyone confirm independently.
//
// It leaks nothing beyond what the batch txid already exposes publicly on-chain — no
// recipient wallet, no names. A forged/tampered link simply resolves to nothing.

export const runtime = "nodejs"
export const dynamic = "force-dynamic" // reads the index per request; never cache a verification

type Params = { txid: string }
type Search = { a?: string | string[] }

function firstParam(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : ""
}

export default async function VerifyReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<Search>
}) {
  const { txid } = await params // Next has already URL-decoded route params
  const auditId = firstParam((await searchParams).a)

  let receipt: Awaited<ReturnType<typeof verifyReceipt>> = null
  let errored = false
  try {
    receipt = txid && auditId ? await verifyReceipt(txid, auditId) : null
  } catch {
    errored = true // fail closed — show "couldn't verify", never a stack
  }

  const explorer = txid ? txExplorerUrl(txid) : null
  const verified = !errored && receipt !== null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-5 py-12 sm:py-16">
      <header className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          PurserPay
        </span>
        <span className="text-[12.5px] text-muted-foreground">Receipt verification</span>
      </header>

      {verified && receipt ? (
        <section
          aria-label="Verified receipt"
          className="flex flex-col gap-5 rounded-[14px] border border-border bg-card px-6 py-6"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            <h1 className="text-[17px] font-semibold tracking-tight text-foreground">
              Verified PurserPay payout
            </h1>
          </div>

          <p className="text-[32px] leading-none font-semibold tracking-tight text-foreground">
            {formatUsdtAmount(receipt.amountBaseUnits)}{" "}
            <span className="text-[18px] font-medium text-muted-foreground">USDT</span>
          </p>

          <dl className="flex flex-col gap-3 text-[13.5px]">
            <Field label="Paid by (agency)">
              <span className="font-mono text-foreground">{shortWallet(receipt.payerWallet)}</span>
            </Field>
            <Field label="Date (UTC)">{formatUtcDate(receipt.blockTs, "")}</Field>
            <Field label="Network">{NETWORK.name}</Field>
            <Field label="Audit ID">
              <span className="font-mono text-foreground">{receipt.auditId}</span>
            </Field>
          </dl>

          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            This amount is read from the TRON blockchain for this batch — not from any
            document. Confirm it independently on Tronscan.
          </p>

          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-[10px] border border-border bg-background px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              View the batch on Tronscan
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </section>
      ) : (
        <section
          aria-label="Receipt not verified"
          className="flex flex-col gap-4 rounded-[14px] border border-border bg-card px-6 py-6"
        >
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="size-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-[17px] font-semibold tracking-tight text-foreground">
              We couldn&rsquo;t verify this receipt
            </h1>
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            This link doesn&rsquo;t match a payout recorded through PurserPay. The receipt
            may have been altered, or the reference is incomplete. You can still inspect the
            underlying transaction on-chain and judge it for yourself.
          </p>
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-[10px] border border-border bg-background px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              View the transaction on Tronscan
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </section>
      )}

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        PurserPay is a non-custodial payout tool. This page proves a real on-chain payment;
        it is not a tax, invoice, or legal document.{" "}
        <Link href="/" className="text-primary hover:underline">
          purserpay
        </Link>
      </p>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="text-[12px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  )
}
