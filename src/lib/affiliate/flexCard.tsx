import "server-only"

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ImageResponse } from "next/og"
import qrcode from "qrcode-generator"

import type { FlexModel } from "./flexModel"

// The Flex Card renderer (Sprint 1C) — turns a pure FlexModel into a 1200×630 branded
// PNG via next/og (Satori). Kept apart from flexModel.ts so the privacy logic stays
// unit-testable without next/og. Generated on the fly; the route NEVER stores it.
//
// PUBLIC BRAND SURFACE: warm bone ground, graphite ink, aqua accent, Inter Tight —
// sober = high status ("Swiss bank receipt"), never dark-mode/terminal-green (D2.1).
// Inter Tight is a VENDORED static woff (./fonts) — Satori can't use the app's woff2
// variable font. Loaded via new URL(import.meta.url) so Next traces it for Vercel.
//
// The check glyph (✓) is drawn as an inline SVG, NOT a font glyph — the latin woff
// subset omits U+2713, which would render as tofu.

const WIDTH = 1200
const HEIGHT = 630

const BONE = "#FAF9F7"
const SURFACE = "#FFFFFF"
const INK = "#111014"
const MUTED = "#615C57"
const AQUA = "#0FB5C9"
const HAIRLINE = "#E5E2DD"

// Read the VENDORED static woff from the filesystem — Satori can't use the app's woff2
// variable font, and node fetch() rejects the file: scheme that new URL(import.meta.url)
// would yield. process.cwd() is the project root in dev AND the traced function root on
// Vercel (next.config.mjs `outputFileTracingIncludes` bundles these files). Cached once.
const FONT_DIR = join(process.cwd(), "src", "lib", "affiliate", "fonts")
let fonts: { regular: Buffer; bold: Buffer } | null = null
function loadFonts(): { regular: Buffer; bold: Buffer } {
  if (!fonts) {
    fonts = {
      regular: readFileSync(join(FONT_DIR, "InterTight-Regular.woff")),
      bold: readFileSync(join(FONT_DIR, "InterTight-Bold.woff")),
    }
  }
  return fonts
}

/** A QR for `url` as an SVG data-URI (Satori-safe <img> source). qrcode-generator is
 *  the 1B dep — no new library. */
function qrDataUri(url: string): string {
  const qr = qrcode(0, "M")
  qr.addData(url)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true })
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")
}

const CHECK_URI =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="${BONE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  ).toString("base64")

function letalRow(label: string, value: string) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 20, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: INK }}>{value}</span>
    </div>
  )
}

/** Render the Flex Card PNG for `model`. */
export async function renderFlexCard(model: FlexModel): Promise<ImageResponse> {
  const { regular, bold } = loadFonts()
  const qr = qrDataUri(model.qrUrl)

  const element = (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: BONE,
        color: INK,
        fontFamily: "Inter Tight",
        padding: 60,
        position: "relative",
      }}
    >
      {/* top accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 10,
          background: AQUA,
        }}
      />

      {/* Header: wordmark + verified badge */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 46,
              height: 46,
              borderRadius: 12,
              background: AQUA,
            }}
          />
          <span style={{ fontSize: 38, fontWeight: 700, color: INK }}>PurserPay</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: AQUA,
            borderRadius: 999,
            padding: "10px 20px",
          }}
        >
          <img src={CHECK_URI} width={22} height={22} alt="" />
          <span style={{ fontSize: 22, fontWeight: 700, color: BONE }}>{model.badge}</span>
        </div>
      </div>

      {/* Center: the amount, per the privacy toggle */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 96, fontWeight: 700, color: INK, lineHeight: 1 }}>
          {model.amountPrimary}
        </span>
        <span style={{ fontSize: 28, color: MUTED }}>{model.amountSecondary}</span>
        {model.verifyRef ? (
          <span style={{ fontSize: 18, color: AQUA, marginTop: 6 }}>
            Verify on-chain: {model.verifyRef}
          </span>
        ) : null}
      </div>

      {/* Footer: letal-line quadrant + capture QR quadrant */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {letalRow("Intermediary fee:", "0%")}
          {letalRow("Network:", model.networkLine)}
          {letalRow("", model.txShort)}
          {model.auditId ? letalRow("Audit ID:", model.auditId) : null}
          <span style={{ fontSize: 20, fontWeight: 700, color: AQUA }}>
            {model.settledLine}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            width: 320,
          }}
        >
          <div
            style={{
              display: "flex",
              padding: 12,
              background: SURFACE,
              borderRadius: 16,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <img src={qr} width={168} height={168} alt="" />
          </div>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: INK,
              textAlign: "center",
              lineHeight: 1.15,
            }}
          >
            {model.captureCopy}
          </span>
        </div>
      </div>
    </div>
  )

  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Inter Tight", data: regular, weight: 400, style: "normal" },
      { name: "Inter Tight", data: bold, weight: 700, style: "normal" },
    ],
    // Generated on the fly, never stored — and never cached by a shared proxy.
    headers: { "cache-control": "no-store" },
  })
}
