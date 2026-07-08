import type { Metadata, Viewport } from "next"

// Global styles — the single Tailwind v4 CSS-first entry (unchanged from the Vite
// build). It also pulls in tw-animate-css, shadcn/tailwind.css, and the Fontsource
// variable font packages via its own @import lines.
import "@/styles/globals.css"

export const metadata: Metadata = {
  title: "PurserPay | On-Chain Payouts",
  icons: { icon: "/favicon.svg" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
