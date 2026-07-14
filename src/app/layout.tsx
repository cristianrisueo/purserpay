import type { Metadata, Viewport } from "next"

// Global styles — the single Tailwind v4 CSS-first entry (unchanged from the Vite
// build). It also pulls in tw-animate-css, shadcn/tailwind.css, and the Fontsource
// variable font packages via its own @import lines.
import "@/styles/globals.css"

import { SandboxBanner } from "@/components/SandboxBanner"

export const metadata: Metadata = {
  // Resolves the relative OG/Twitter image path to an absolute URL and silences the
  // Next.js "metadataBase not set" build warning.
  metadataBase: new URL("https://purserpay.app"),
  title: "PurserPay — Non-custodial payouts for distributed teams",
  description:
    "Pay everyone in one transfer. Your money never leaves your wallet. Your roster never leaves your device.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "PurserPay — Non-custodial payouts for distributed teams",
    description:
      "Pay everyone in one transfer. Your money never leaves your wallet. Your roster never leaves your device.",
    url: "https://purserpay.app",
    siteName: "PurserPay",
    images: [
      { url: "/screen_one.png", width: 1200, height: 630, alt: "PurserPay Preview" },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PurserPay — Non-custodial payouts for distributed teams",
    description:
      "Pay everyone in one transfer. Your money never leaves your wallet. Your roster never leaves your device.",
    images: ["/screen_one.png"],
  },
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
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Non-mainnet builds only; dead-weight on a mainnet build (renders null). */}
        <SandboxBanner />
        {children}
      </body>
    </html>
  )
}
