// The 1B receipt PDF -- a "proof of source of funds" a payee shows an exchange or
// bank: proof that THIS wallet was paid THIS amount THROUGH PurserPay's disperse
// contract. It is generated on the fly and NEVER stored (docs/09 §5).
//
// IT IS NOT a tax document, an invoice, or legal/fiscal advice -- the footer says so,
// and the copy must never imply otherwise.
//
// Verifiability, not decoration (D4): the page carries a QR to the PUBLIC
// /verify/[txid]?a=<auditId> page, which shows the real on-chain amount for that
// batch. A Photoshopped amount here is contradicted there.
//
// PURE PRESENTATION: this builder takes already-formatted display strings (the route
// composes them from the chain-derived index). It imports NO config/env, holds no
// secret and touches no DB, so it is intentionally NOT marked `server-only`: it stays
// framework-agnostic and unit-testable under `node --test` with literal inputs. Only
// the route (which reads the index) is server-bound. Do not add a config/DB import.
//
// Deps (flagged in the sprint report): pdf-lib (zero-runtime-dep PDF writer) and
// qrcode-generator (tiny, zero-dep QR matrix, drawn here as crisp vector cells).
//
// All text drawn here is WinAnsi-safe (StandardFonts.Helvetica); dynamic inputs are
// base58 / hex / digits / the "…" truncation glyph, all encodable.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import qrcode from "qrcode-generator"

// Brand tokens (the ACTUAL repo tokens -- CLAUDE.md design tokens).
const AQUA = rgb(0x0f / 255, 0xb5 / 255, 0xc9 / 255)
const INK = rgb(0x11 / 255, 0x10 / 255, 0x14 / 255)
const MUTED = rgb(0x61 / 255, 0x5c / 255, 0x57 / 255)
const HAIRLINE = rgb(0xe5 / 255, 0xe2 / 255, 0xdd / 255)

export type ReceiptPdfInput = {
  /** Human amount, already grouped, e.g. "1,450.5" (the builder appends " USDT"). */
  amountDisplay: string
  /** The payee's own wallet, truncated (owner decision -- minimal doxxing on a
   *  document that travels). e.g. "TAbc…wXyz". */
  recipientShort: string
  /** The paying agency wallet (public on-chain), shown in full. */
  payerWallet: string
  /** UTC date, e.g. "14 Nov 2023". */
  dateDisplayUtc: string
  /** Network label (nile | mainnet). */
  network: string
  /** The disperse batch txid (public). */
  txid: string
  /** The verifiable Audit ID (from the stored generated column). */
  auditId: string
  /** Absolute URL to the public verification page (encoded into the QR). */
  verifyUrl: string
  /** Tronscan link for the txid (printed for an independent chain check). */
  explorerUrl: string
}

const PAGE_W = 595.28 // A4 portrait, points
const PAGE_H = 841.89
const MARGIN = 56

/** Greedily wrap a single long token (txid / wallet / url) to fit `maxWidth`. */
function wrapToken(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let cur = ""
  for (const ch of text) {
    const next = cur + ch
    if (cur && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(cur)
      cur = ch
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [""]
}

/** Word-wrap normal prose (spaces) to fit `maxWidth`. */
function wrapWords(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ""
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(cur)
      cur = w
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [""]
}

/** Draw a QR (from its module matrix) as filled vector cells, top-left at (x, yTop). */
function drawQr(page: PDFPage, data: string, x: number, yTop: number, box: number): void {
  const qr = qrcode(0, "M")
  qr.addData(data)
  qr.make()
  const count = qr.getModuleCount()
  const quiet = 4 // standard quiet zone, in modules
  const span = count + quiet * 2
  const cell = box / span
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue
      page.drawRectangle({
        x: x + (c + quiet) * cell,
        // pdf-lib y grows upward; row 0 is the top of the QR.
        y: yTop - box + (span - (r + quiet + 1)) * cell,
        width: cell + 0.4, // hairline overlap so cells don't show seams
        height: cell + 0.4,
        color: INK,
      })
    }
  }
}

/**
 * Build the one-page receipt PDF. Returns the raw bytes; the route streams them
 * (application/pdf, attachment) and never persists them.
 */
export async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`PurserPay payout receipt · ${input.auditId}`)
  doc.setCreator("PurserPay")
  doc.setProducer("PurserPay")

  const page = doc.addPage([PAGE_W, PAGE_H])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const contentW = PAGE_W - MARGIN * 2

  let y = PAGE_H - MARGIN

  // --- Header ---------------------------------------------------------------
  page.drawText("PurserPay", { x: MARGIN, y: y - 18, size: 20, font: bold, color: INK })
  page.drawText("Payout receipt", { x: MARGIN, y: y - 36, size: 11, font, color: MUTED })
  y -= 50
  page.drawRectangle({ x: MARGIN, y, width: contentW, height: 2, color: AQUA })
  y -= 34

  // --- Amount (the headline) ------------------------------------------------
  page.drawText(`${input.amountDisplay} USDT`, {
    x: MARGIN,
    y: y - 30,
    size: 32,
    font: bold,
    color: INK,
  })
  y -= 30 + 26

  // --- Detail fields (label over value, long values wrap) -------------------
  const fields: Array<{ label: string; value: string }> = [
    { label: "Paid to", value: input.recipientShort },
    { label: "Paid by (agency)", value: input.payerWallet },
    { label: "Date (UTC)", value: input.dateDisplayUtc },
    { label: "Network", value: input.network },
    { label: "Batch transaction", value: input.txid },
    { label: "Audit ID", value: input.auditId },
  ]
  for (const { label, value } of fields) {
    page.drawText(label.toUpperCase(), { x: MARGIN, y, size: 8, font, color: MUTED })
    y -= 15
    for (const line of wrapToken(value, font, 11, contentW)) {
      page.drawText(line, { x: MARGIN, y, size: 11, font, color: INK })
      y -= 15
    }
    y -= 8
  }

  // --- Verification block (the anti-Photoshop anchor) -----------------------
  y -= 6
  page.drawRectangle({ x: MARGIN, y, width: contentW, height: 1, color: HAIRLINE })
  y -= 20

  const qrBox = 108
  const qrTop = y
  drawQr(page, input.verifyUrl, MARGIN, qrTop, qrBox)

  const textX = MARGIN + qrBox + 22
  const textW = PAGE_W - MARGIN - textX
  let ty = qrTop - 4
  page.drawText("Verify this receipt", { x: textX, y: ty, size: 12, font: bold, color: INK })
  ty -= 18
  const blurb =
    "Scan the code, or open the link below. It shows the amount read from the TRON " +
    "blockchain for this batch, not from this document."
  for (const line of wrapWords(blurb, font, 9.5, textW)) {
    page.drawText(line, { x: textX, y: ty, size: 9.5, font, color: MUTED })
    ty -= 13
  }
  ty -= 4
  for (const line of wrapToken(input.verifyUrl, font, 8.5, textW)) {
    page.drawText(line, { x: textX, y: ty, size: 8.5, font, color: AQUA })
    ty -= 11
  }

  // --- Footer disclaimer (bottom of page) -----------------------------------
  const disclaimer =
    "This document is proof of a payment made through PurserPay's disperse contract. " +
    "It is not a tax document, an invoice, or legal or fiscal advice."
  const footerLines = wrapWords(disclaimer, font, 8.5, contentW)
  let fy = MARGIN + 24 + (footerLines.length - 1) * 11
  const footerTop = fy
  for (const line of footerLines) {
    page.drawText(line, { x: MARGIN, y: fy, size: 8.5, font, color: MUTED })
    fy -= 11
  }
  page.drawText(`View the batch on-chain: ${input.explorerUrl}`, {
    x: MARGIN,
    y: MARGIN + 4,
    size: 8,
    font,
    color: MUTED,
  })
  page.drawRectangle({ x: MARGIN, y: footerTop + 14, width: contentW, height: 1, color: HAIRLINE })

  return doc.save()
}
