"use client"

import { useCallback, useState } from "react"
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Gift,
  Loader2,
  Share2,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { downloadFlexCard } from "@/lib/affiliate/flexClient"
import {
  DEFAULT_FLEX_MODE,
  figureCount,
  groupThousands,
  rangeBucket,
  type FlexMode,
} from "@/lib/affiliate/flexModel"
import {
  fetchAffiliatePortal,
  type AffiliatePortalData,
  type AffiliateReceiptRow,
} from "@/lib/affiliate/portalClient"
import { downloadReceiptPdf } from "@/lib/affiliate/receiptClient"
import { fromBaseUnits } from "@/lib/tron/amount"
import { txExplorerUrl, USDT_DECIMALS } from "@/lib/tron/config"
import { getWalletProvider } from "@/lib/tron/wallet"
import { humanize } from "@/lib/tron/errors"

// The payee-facing affiliate portal. A payee proves they control their wallet with ONE
// signature (a PORTAL-purpose challenge that authorizes NO on-chain action) and sees
// their disperse-anchored receipts — hard proof they were paid THROUGH PurserPay.
//
// PRIVACY (docs/09): the history is keyed on hash(signer) server-side, so a viewer sees
// ONLY payouts to the wallet they just proved they control. There is no code in the URL
// and no admin-pastes-wallet backdoor. Nothing renders without the signature.
//
// The value comes FIRST; the ask (refer your other agencies) sits BELOW it. Brand
// tokens only (aqua/bone/cream, Inter Tight) — matches the dashboard/landing.

type Phase = "idle" | "loading" | "ready" | "error"

/** TAbc…wXyz — a compact, non-doxxing rendering of a public agency wallet. */
function shortWallet(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

/** Human USDT from base units, e.g. "1,450.5". Falls back to the raw string if the
 *  value somehow isn't a clean uint (never throws in render). */
function formatUsdt(baseUnits: string): string {
  try {
    const n = Number(fromBaseUnits(BigInt(baseUnits)))
    return n.toLocaleString("en-US", { maximumFractionDigits: 6 })
  } catch {
    return baseUnits
  }
}

/** A payout date in UTC (the on-chain instant, if known, else when we indexed it). */
function formatUtcDate(row: AffiliateReceiptRow): string {
  const iso = row.blockTs ?? row.recordedAt
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d)
}

export function AffiliatePortal() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [data, setData] = useState<AffiliatePortalData | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // One click → connect if needed → one signature → fetch. ≤3 clicks, fail-loud.
  const view = useCallback(async () => {
    setPhase("loading")
    setError(null)
    try {
      const provider = getWalletProvider("tronlink")
      // getAddress() reads an already-authorized session without a prompt; connect()
      // only prompts if none exists.
      const account = provider.getAddress() ?? (await provider.connect()).address
      const payload = await fetchAffiliatePortal("tronlink", account)
      // Keep the proven wallet so each receipt row can re-sign for its OWN PDF (1B).
      setAddress(account)
      setData(payload)
      setPhase("ready")
    } catch (e) {
      setError(humanize(e).message)
      setPhase("error")
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-5 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <span
          className="inline-flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <ShieldCheck className="size-4.5" />
        </span>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Your PurserPay receipts
        </h1>
        <p className="max-w-prose text-[14px] leading-relaxed text-muted-foreground">
          Verify your wallet to see every payout you&rsquo;ve received through PurserPay.
          Signing only proves the wallet is yours — it authorizes no payment and moves no
          funds.
        </p>
      </header>

      {phase !== "ready" && (
        <div className="flex flex-col items-start gap-3 rounded-[14px] border border-border bg-card px-5 py-5">
          <Button
            type="button"
            onClick={view}
            disabled={phase === "loading"}
            aria-busy={phase === "loading"}
            className="h-auto rounded-[10px] px-[18px] py-2.5 text-[14.5px] font-semibold"
          >
            {phase === "loading" ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Verifying…
              </>
            ) : (
              "Verify wallet & view receipts"
            )}
          </Button>
          {phase === "error" && error && (
            <p className="text-[13px] leading-relaxed text-destructive">{error}</p>
          )}
        </div>
      )}

      {phase === "ready" && data && (
        <>
          <ReceiptsList receipts={data.receipts} address={address} />
          <ViralBanner />
          <ReferralPanel code={data.referralCode} bounty={data.bounty} />
        </>
      )}
    </main>
  )
}

// --- Receipts (the value, first) ---------------------------------------------

function ReceiptsList({
  receipts,
  address,
}: {
  receipts: AffiliateReceiptRow[]
  address: string | null
}) {
  if (receipts.length === 0) {
    return (
      <section aria-label="Your receipts">
        <div className="rounded-[14px] border border-dashed border-border bg-card px-5 py-8 text-center">
          <p className="text-[14px] font-medium text-foreground">No receipts yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            When an agency pays you through PurserPay, the payout shows up here — with the
            paying wallet, the amount, and a link to verify it on-chain.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Your receipts" className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
        {receipts.length} payment{receipts.length === 1 ? "" : "s"} received
      </h2>
      {/* Cap the list to its own scroll area (FIX-2): the referral block below is the
          growth engine — with 100 receipts an uncapped list would bury it beneath the
          fold and the payee would never share. Bounding the list here keeps value-first
          order (receipts still come first) while guaranteeing the prompt + link stay
          reachable in ~one viewport, at any receipt count. `max-h` only caps, so a short
          list is unaffected. */}
      <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto pr-1">
        {receipts.map((r) => (
          // txid key: a wallet appears at most once per disperse tx (the unique
          // (txid, recipient) in the index), so txid is stable per row here.
          <ReceiptRow key={r.txid} r={r} address={address} />
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Every row is a real disperse from PurserPay&rsquo;s payout contract. &ldquo;PDF&rdquo;
        downloads a verifiable proof of payment; &ldquo;Verify&rdquo; opens the transaction on
        Tronscan.
      </p>
    </section>
  )
}

// The privacy modes, safe-first. `hidden` is pre-selected (owner decision) so a
// hurried payee who just hits Generate can't leak a targetable figure.
const FLEX_MODES: { id: FlexMode; label: string; sub: string }[] = [
  { id: "hidden", label: "Hidden", sub: "Only a digit count — safest to post" },
  { id: "range", label: "Range", sub: "A rounded floor; hides the exact figure" },
  { id: "exact", label: "Exact", sub: "The precise amount, verifiable on-chain" },
]

// One receipt row. The "PDF" button is the PRIMARY per-row action (B2 — the receipt IS
// the value, so it sits ahead of everything). "Share" is SECONDARY (D1.1 — the bonus,
// never outshining the PDF): it opens a MANDATORY privacy toggle before building a
// public Flex Card. Both re-prove wallet control with a fresh PORTAL signature (the 1A
// nonce is single-use). Fails loud with a calm inline message; never a silent no-op.
function ReceiptRow({
  r,
  address,
}: {
  r: AffiliateReceiptRow
  address: string | null
}) {
  const [downloading, setDownloading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Flex Card state — the mandatory toggle defaults to the SAFE mode.
  const [flexOpen, setFlexOpen] = useState(false)
  const [mode, setMode] = useState<FlexMode>(DEFAULT_FLEX_MODE)
  const [flexBusy, setFlexBusy] = useState(false)
  const [flexErr, setFlexErr] = useState<string | null>(null)

  const download = useCallback(async () => {
    if (!address) return
    setDownloading(true)
    setErr(null)
    try {
      await downloadReceiptPdf("tronlink", address, r.txid)
    } catch (e) {
      setErr(humanize(e).message)
    } finally {
      setDownloading(false)
    }
  }, [address, r.txid])

  const generate = useCallback(async () => {
    if (!address) return
    setFlexBusy(true)
    setFlexErr(null)
    try {
      await downloadFlexCard("tronlink", address, r.txid, mode)
      setFlexOpen(false)
    } catch (e) {
      setFlexErr(humanize(e).message)
    } finally {
      setFlexBusy(false)
    }
  }, [address, r.txid, mode])

  // A LOCAL preview of the amount line each mode would show, so the payee sees exactly
  // what they'd expose before posting. Uses the pure flexModel helpers (no server call).
  const wholeUsdt = (() => {
    try {
      return BigInt(r.amountBaseUnits) / 10n ** BigInt(USDT_DECIMALS)
    } catch {
      return 0n
    }
  })()
  const previewFor = (m: FlexMode): string => {
    if (m === "exact") return `${formatUsdt(r.amountBaseUnits)} USDT`
    if (m === "range") {
      const b = rangeBucket(wholeUsdt)
      if (b !== null) return `+${groupThousands(b)} USDT`
    }
    const n = figureCount(wholeUsdt)
    return n > 0 ? `${n}-figure payment` : "Payment verified"
  }

  return (
    <li className="flex flex-col gap-2 rounded-[12px] border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground">
            {formatUsdt(r.amountBaseUnits)} USDT
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            From{" "}
            <span className="font-mono text-foreground/80">{shortWallet(r.payerWallet)}</span>{" "}
            · {formatUtcDate(r)} UTC
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            onClick={download}
            disabled={downloading || !address}
            aria-busy={downloading}
            aria-label="Download this receipt as a PDF"
            className="h-auto rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold"
          >
            {downloading ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            PDF
          </Button>
          {/* Secondary: the Flex Card (the bonus, never louder than the PDF). */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setFlexOpen(true)}
            disabled={!address}
            aria-label="Share this payment as an image"
            className="h-auto rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-medium"
          >
            <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
            Share
          </Button>
          {/* The raw-chain escape hatch. */}
          <a
            href={txExplorerUrl(r.txid)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-[10px] border border-border bg-background px-2.5 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted"
          >
            Verify
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
      {err && <p className="text-[12px] leading-relaxed text-destructive">{err}</p>}

      <Dialog open={flexOpen} onOpenChange={setFlexOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this payment</DialogTitle>
            <DialogDescription>
              Choose how the amount appears on the image before you post it. Your wallet
              address never appears on the card.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {FLEX_MODES.map((m) => {
              const selected = mode === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={selected}
                  className={`flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/[0.06] ring-1 ring-primary"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-foreground">
                      {m.label}
                      {m.id === DEFAULT_FLEX_MODE && (
                        <span className="ml-2 text-[11px] font-medium text-primary">
                          safest
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {m.sub}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12.5px] text-foreground/80">
                    {previewFor(m.id)}
                  </span>
                </button>
              )
            })}
          </div>

          {flexErr && (
            <p className="text-[12px] leading-relaxed text-destructive">{flexErr}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFlexOpen(false)}
              disabled={flexBusy}
              className="h-auto rounded-[10px] px-3.5 py-2 text-[13px] font-medium"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={generate}
              disabled={flexBusy || !address}
              aria-busy={flexBusy}
              className="h-auto rounded-[10px] px-3.5 py-2 text-[13px] font-semibold"
            >
              {flexBusy ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  Generating…
                </>
              ) : (
                "Generate & download"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}

// --- Viral banner (COPY ONLY — the ask, below the gift) ----------------------
// No payout engine here (C4): this is a pitch, not a button. The 50 USDT/mo × 6mo
// bounty is stated; the actual accrual + payout is manual/off-portal.

function ViralBanner() {
  return (
    <section
      aria-label="Refer your other agencies"
      className="rounded-[14px] border border-primary/20 bg-primary/[0.06] px-5 py-4"
    >
      <p className="text-[14px] leading-relaxed font-medium text-foreground">
        Doesn&rsquo;t your other agency know PurserPay yet?
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        Refer us and earn up to <b>300 USDT</b> — 50 for each month they stay with us, for
        their first 6.
      </p>
    </section>
  )
}

// --- Referral panel (opaque code + pending bounty figure) --------------------

function ReferralPanel({
  code,
  bounty,
}: {
  code: string
  bounty: AffiliatePortalData["bounty"]
}) {
  const [origin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  )
  const [copied, setCopied] = useState(false)

  // The share link resolves to the EXISTING /r/{code} attribution route. The wallet is
  // NEVER in the link — only the opaque code.
  const link = code ? `${origin}/r/${code}` : ""
  const displayLink = link.replace(/^https?:\/\//, "")

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — link stays visible */
    }
  }

  return (
    <section
      aria-label="Your referral link"
      className="rounded-[14px] border border-border bg-card px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Gift className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[14px] font-semibold text-foreground">Your referral link</h2>
            <span className="text-[12.5px] text-muted-foreground">
              {bounty.referredCount} agenc{bounty.referredCount === 1 ? "y" : "ies"} referred
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-[12.5px] text-foreground">
              {displayLink || "unavailable"}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={copy}
              disabled={!link}
              className="h-auto shrink-0 rounded-[10px] px-3 py-2 text-[13px] font-medium"
              aria-label="Copy your referral link"
            >
              {copied ? (
                <>
                  <Check className="mr-1.5 size-3.5 text-success" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </Button>
          </div>

          {/* The figure is a DEBT ACCUMULATOR the owner settles by hand — NOT a wallet
              balance and NOT an on-chain amount. Labelled pending, never "received". */}
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">{bounty.accruedTotal} USDT</b> accrued · pending
            (paid out manually). Earned as the agencies you refer keep paying — up to 6
            months each.
          </p>
        </div>
      </div>
    </section>
  )
}
