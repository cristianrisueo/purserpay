import type { Metadata } from "next"

import { SiteFooter } from "@/components/landing/SiteFooter"
import { SiteHeader } from "@/components/landing/SiteHeader"

export const metadata: Metadata = {
  title: "Privacy & Cookie Policy | PurserPay",
  description:
    "How PurserPay handles data: a device-local payout roster, encrypted and dissociated billing PII, transient sanctions screening, and no tracking or analytics cookies.",
}

// /privacy — a static, local-disclosures policy in the existing light system
// (shared SiteHeader + SiteFooter). Numbered legal sections with sub-points.
// No client state, no chain code. Every claim is reconciled to the real
// architecture and kept consistent with /legal (data dissociation: device-local
// roster + encrypted, dissociated server-side billing PII).

type SubPoint = { label: string; body: string }
type PolicySection = { n: string; heading: string; intro?: string; points?: SubPoint[] }

const sections: PolicySection[] = [
  {
    n: "1",
    heading: "Stateless architecture & data minimization",
    intro:
      "PurserPay runs no user accounts and keeps no centralized store of your operational data. What little we do hold is minimized and dissociated by design.",
    points: [
      {
        label: "Payroll & roster data",
        body: "Every CSV file, wallet distribution, payee name, and payout amount is parsed and held strictly inside your own browser (IndexedDB). Your roster is never uploaded to us and never leaves your device in readable form.",
      },
      {
        label: "Account & billing details",
        body: "The one exception is the account holder's own billing information (legal name, country of incorporation, tax ID), used to invoice the software subscription. It is stored server-side, encrypted at rest (AES-256 via pgcrypto) and keyed by a one-way wallet hash — dissociated by design, so your identity is never tied to your payouts.",
      },
      {
        label: "Non-custodial principle",
        body: "We never collect, store, or access your private keys, seed phrases, or funds. All on-chain actions are signed directly by your own TRON wallet.",
      },
    ],
  },
  {
    n: "2",
    heading: "Technical storage & cookie disclosure",
    intro:
      "To comply with global data-protection frameworks (including GDPR), we use native browser storage instead of tracking cookies. We deploy no marketing, analytics, or third-party profiling cookies.",
    points: [
      {
        label: "Browser storage",
        body: "Your roster and active distribution tables live in your browser's IndexedDB. Small technical values — wallet connection state and interface preferences — may use localStorage or a strictly technical session cookie. None of it is transmitted to us.",
      },
      {
        label: "Session lifecycle",
        body: "This data is entirely user-controlled. Clearing your browser's site data, cache, or cookies destroys all local records permanently.",
      },
    ],
  },
  {
    n: "3",
    heading: "Server-side compliance & network routing",
    intro: "Before a batch can be signed, the platform performs two validation steps.",
    points: [
      {
        label: "OFAC & sanctions screening",
        body: "Destination addresses are screened server-side against international sanctions lists. Each address is salted-hashed and checked in memory; addresses are never stored, logged, or tied to your identity, and a match blocks the batch.",
      },
      {
        label: "Public ledger interactions",
        body: "Once you sign, the transaction is routed to public TRON nodes. On-chain data (recipient addresses, amounts, block timestamps) is inherently public and immutable by the nature of distributed ledgers.",
      },
    ],
  },
  {
    n: "4",
    heading: "Your rights & data control",
    intro: "You hold sovereignty over your operational history.",
    points: [
      {
        label: "Your roster",
        body: "Device-local and under your sole control — erase it any time by clearing your browser's site data.",
      },
      {
        label: "Your billing details",
        body: "You may request erasure at any time (GDPR Art. 17); on request we permanently wipe your encrypted billing record from our database.",
      },
    ],
  },
  {
    n: "5",
    heading: "Contact",
    intro:
      "For technical or infrastructure support, contact our operational desk at dorian@sailorlabs.xyz.",
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[720px] px-8 py-[clamp(48px,7vw,88px)]">
        <h1 className="mb-2 text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-[-0.025em] text-foreground">
          Privacy &amp; Cookie Policy
        </h1>
        <p className="mb-8 font-mono text-[12px] tracking-[0.06em] text-muted-foreground">
          Last updated: July 2026
        </p>

        <p className="mb-10 max-w-[64ch] text-[15.5px] leading-[1.7] text-muted-foreground">
          This policy explains how PurserPay (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the
          platform&rdquo;) handles data through its stateless web interface. PurserPay is built
          around data dissociation: your payout roster never leaves your device, and the only
          information we hold — your own billing details — is encrypted and stored apart from any
          payout activity.
        </p>

        {sections.map((s) => (
          <section key={s.n} className="mb-9 last:mb-0">
            <h2 className="mb-3 text-[17px] font-semibold text-foreground">
              {s.n}. {s.heading}
            </h2>
            {s.intro && (
              <p className="max-w-[64ch] text-[15.5px] leading-[1.7] text-muted-foreground">
                {s.intro}
              </p>
            )}
            {s.points && (
              <div className="mt-4 flex flex-col gap-3.5">
                {s.points.map((p) => (
                  <p
                    key={p.label}
                    className="max-w-[64ch] text-[15.5px] leading-[1.7] text-muted-foreground"
                  >
                    <span className="font-semibold text-foreground">{p.label}:</span>{" "}
                    {p.body}
                  </p>
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  )
}
