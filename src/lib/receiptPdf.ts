// Client-side receipt "PDF" generation with zero dependencies. We render a clean,
// self-contained HTML receipt into a hidden iframe and invoke the browser's own
// print pipeline — the user saves it as a PDF. Fully local (same promise as the
// roster: no server, no upload), and it never touches funds, keys, or the chain;
// it only reads a receipt the user already holds in IndexedDB.

import { payoutTitle } from "@/lib/format"

export type ReceiptLine = { name: string; address: string; amount: number }

export type ReceiptDoc = {
  /** On-chain disperse tx hash. */
  txid: string
  /** Tronscan URL for `txid` (built by the caller from the app's network). */
  explorerUrl: string
  /** Human network name, e.g. "Nile testnet". */
  networkName: string
  /** Date.now() at confirmation. */
  timestamp: number
  /** Who got exactly what, snapshotted at pay time. */
  recipients: ReceiptLine[]
}

/** One paid recipient in the full report — carries its own tx + time, because a
 *  report spans many batches (unlike a single-batch receipt). */
export type ReportLine = {
  name: string
  address: string
  amount: number
  /** Date.now() at the batch's confirmation. */
  timestamp: number
  /** The batch's on-chain tx hash. */
  txid: string
  /** Tronscan URL for `txid` (built by the caller from the app's network). */
  explorerUrl: string
}

export type ReportDoc = {
  /** Human network name, e.g. "Nile testnet". */
  networkName: string
  /** Date.now() when the report was generated. */
  generatedAt: number
  /** Every paid recipient across every payout, in the order to print. */
  lines: ReportLine[]
}

/** Escape user-supplied strings (names/addresses) before interpolating into HTML. */
function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string
  )
}

/** Grouped USDT amount, exact to USDT's 6-dp precision, trailing zeros trimmed. */
function fmtAmount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(n)
}

function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(ts))
}

/** Middle-ellipsis a tx hash so the report's Tx column stays narrow. */
function shortHash(hash: string): string {
  return hash.length <= 18 ? hash : `${hash.slice(0, 10)}…${hash.slice(-8)}`
}

function renderReceiptHtml(doc: ReceiptDoc): string {
  const total = doc.recipients.reduce((sum, r) => sum + r.amount, 0)

  const rows = doc.recipients
    .map(
      (r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="name">${esc(r.name)}</td>
        <td class="addr">${esc(r.address)}</td>
        <td class="amt">${fmtAmount(r.amount)}</td>
      </tr>`
    )
    .join("")

  // Brand tokens are inlined (this is a standalone document, not the app DOM):
  // aqua #0FB5C9, ink #111014, muted #615C57, hairline #E5E2DD, success #2F9E6B.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(payoutTitle(doc.timestamp))}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    color: #111014;
    background: #ffffff;
    padding: 40px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  .brand span { color: #0FB5C9; }
  .head {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid #E5E2DD; padding-bottom: 16px; margin-bottom: 22px;
  }
  .doc-title { font-size: 13px; font-weight: 600; color: #615C57; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 26px; }
  .meta .k { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #615C57; }
  .meta .v { font-size: 13.5px; font-weight: 600; word-break: break-all; }
  .meta a { color: #0FB5C9; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    text-align: left; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
    color: #615C57; font-weight: 600; padding: 8px 10px; border-bottom: 1px solid #E5E2DD;
  }
  tbody td { padding: 11px 10px; font-size: 13px; border-bottom: 1px solid #F0EEEA; vertical-align: top; }
  td.num { color: #93908A; width: 34px; }
  td.name { font-weight: 600; }
  td.addr { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; color: #615C57; }
  th.amt, td.amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.amt { font-weight: 600; }
  tfoot td {
    padding: 14px 10px; font-size: 14px; font-weight: 700; border-top: 2px solid #E5E2DD;
  }
  tfoot td.amt { text-align: right; color: #2F9E6B; }
  /* margin-top:auto pins the disclaimer to the bottom of the page as a footer. */
  .foot { margin-top: auto; padding-top: 28px; font-size: 11px; line-height: 1.5; color: #93908A; }
  /* margin:0 suppresses the browser's own print header/footer; the page margin
     is recreated as body padding so the saved PDF is clean. */
  @media print { @page { margin: 0; } body { padding: 18mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">Purser<span>Pay</span></div>
    </div>
    <div class="doc-title">${esc(fmtDate(doc.timestamp))}</div>
  </div>

  <div class="meta">
    <div>
      <div class="k">Network</div>
      <div class="v">TRON · ${esc(doc.networkName)} · USDT (TRC20)</div>
    </div>
    <div style="grid-column: 1 / -1;">
      <div class="k">Transaction hash</div>
      <div class="v"><a href="${esc(doc.explorerUrl)}">${esc(doc.txid)}</a></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Recipient</th>
        <th>Address</th>
        <th class="amt">USDT</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">Total</td>
        <td class="amt">${fmtAmount(total)} USDT</td>
      </tr>
    </tfoot>
  </table>

  <div class="foot">
    Non-custodial — settled on-chain in a single transaction from the account
    holder's own wallet. Verify this receipt against the transaction hash on
    Tronscan. Generated locally by PurserPay; no payout data left this device.
  </div>
</body>
</html>`
}

function renderReportHtml(doc: ReportDoc): string {
  const total = doc.lines.reduce((sum, l) => sum + l.amount, 0)

  const rows = doc.lines
    .map(
      (l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="when">${esc(fmtDate(l.timestamp))}</td>
        <td class="name">${esc(l.name)}</td>
        <td class="addr">${esc(l.address)}</td>
        <td class="amt">${fmtAmount(l.amount)}</td>
        <td class="tx"><a href="${esc(l.explorerUrl)}">${esc(shortHash(l.txid))}</a></td>
      </tr>`
    )
    .join("")

  // Brand tokens are inlined (this is a standalone document, not the app DOM):
  // aqua #0FB5C9, ink #111014, muted #615C57, hairline #E5E2DD, success #2F9E6B.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Payout report</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    color: #111014;
    background: #ffffff;
    padding: 40px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  .brand span { color: #0FB5C9; }
  .head {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid #E5E2DD; padding-bottom: 16px; margin-bottom: 22px;
  }
  .doc-title { font-size: 13px; font-weight: 600; color: #615C57; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 26px; }
  .meta .k { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #615C57; }
  .meta .v { font-size: 13.5px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    text-align: left; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
    color: #615C57; font-weight: 600; padding: 8px 10px; border-bottom: 1px solid #E5E2DD;
  }
  tbody td { padding: 11px 10px; font-size: 12.5px; border-bottom: 1px solid #F0EEEA; vertical-align: top; }
  td.num { color: #93908A; width: 30px; }
  td.when { white-space: nowrap; color: #615C57; }
  td.name { font-weight: 600; }
  td.addr { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: #615C57; word-break: break-all; }
  th.amt, td.amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.amt { font-weight: 600; }
  td.tx { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; white-space: nowrap; }
  td.tx a { color: #0FB5C9; text-decoration: none; }
  tfoot td {
    padding: 14px 10px; font-size: 14px; font-weight: 700; border-top: 2px solid #E5E2DD;
  }
  tfoot td.amt { text-align: right; color: #2F9E6B; }
  /* margin-top:auto pins the disclaimer to the bottom of the page as a footer. */
  .foot { margin-top: auto; padding-top: 28px; font-size: 11px; line-height: 1.5; color: #93908A; }
  /* margin:0 leaves the browser no room to print its own date/title/page header,
     so the saved PDF is clean; the page margin is recreated as body padding. */
  @media print { @page { margin: 0; } body { padding: 14mm 16mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">Purser<span>Pay</span></div>
    </div>
    <div class="doc-title">${esc(fmtDate(doc.generatedAt))}</div>
  </div>

  <div class="meta">
    <div>
      <div class="k">Network</div>
      <div class="v">TRON · ${esc(doc.networkName)} · USDT (TRC20)</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Date &amp; time</th>
        <th>Recipient</th>
        <th>Address</th>
        <th class="amt">USDT</th>
        <th>Tx</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4">Total</td>
        <td class="amt" colspan="2">${fmtAmount(total)} USDT</td>
      </tr>
    </tfoot>
  </table>

  <div class="foot">
    Non-custodial — every payout above settled on-chain in a single transaction
    from the account holder's own wallet. Verify each line against its transaction
    hash on Tronscan. Generated locally by PurserPay; no payout data left this device.
  </div>
</body>
</html>`
}

/**
 * Render `html` into a hidden same-origin iframe and hand it to the browser's own
 * print pipeline (Save as PDF). Fully local — same promise as the roster: no
 * server, no upload — and it never touches funds, keys, or the chain. Must be
 * called from a user gesture (a click); it is, from the row / footer buttons.
 */
function printHtml(html: string): void {
  if (typeof window === "undefined") return

  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;"
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const idoc = win?.document
  if (!win || !idoc) {
    iframe.remove()
    return
  }

  idoc.open()
  idoc.write(html)
  idoc.close()

  // Written documents may or may not fire `load`; guard so print() runs once,
  // with a short fallback timer covering the no-load case.
  let printed = false
  const printAndCleanup = () => {
    if (printed) return
    printed = true
    try {
      win.focus()
      win.print()
    } finally {
      setTimeout(() => iframe.remove(), 1500)
    }
  }

  win.addEventListener("load", printAndCleanup)
  setTimeout(printAndCleanup, 400)
}

/** Build a single payee's / batch's receipt and print it (Save as PDF). */
export function downloadReceiptPdf(doc: ReceiptDoc): void {
  printHtml(renderReceiptHtml(doc))
}

/** Build the full payout report — every paid recipient across every batch, each
 *  with its own date/time and Tronscan link — and print it (Save as PDF). */
export function downloadReportPdf(doc: ReportDoc): void {
  printHtml(renderReportHtml(doc))
}
