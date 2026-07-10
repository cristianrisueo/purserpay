import type { Metadata } from "next"

import { Eyebrow } from "@/components/landing/Eyebrow"
import { Section } from "@/components/landing/Section"
import { SiteFooter } from "@/components/landing/SiteFooter"
import { SiteHeader } from "@/components/landing/SiteHeader"

export const metadata: Metadata = {
  title: "Legal & compliance | PurserPay",
  description:
    "How PurserPay is built: non-custodial architecture, minimal-KYC corporate billing, data dissociation (GDPR), and automated OFAC screening.",
}

// /legal — a plain-language compliance page. Same light design system as the landing
// (Section / Eyebrow, warm off-white, aqua accent, hairline borders — no dark theme),
// wrapped in the shared SiteHeader + SiteFooter for full cohesion. Text-focused and
// AEO-structured: one numbered heading per posture so an Answer Engine can parse it.
// Every claim tracks CLAUDE.md (non-custodial, ownerless/immutable, salted-SHA-256 OFAC,
// device-local roster, AES-256 PII, minimal B2B billing data).

const WIDTH = "max-w-[760px]"

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[16px] leading-[1.6] text-muted-foreground">
      <span className="mt-[2px] flex-none font-bold text-primary">✓</span>
      <span>{children}</span>
    </li>
  )
}

function Heading({ tag, title }: { tag: string; title: string }) {
  return (
    <>
      <Eyebrow className="mb-4">{tag}</Eyebrow>
      <h2 className="mb-5 max-w-[22ch] text-[clamp(1.5rem,2.8vw,2.05rem)] font-bold leading-[1.1] tracking-[-0.025em] text-foreground">
        {title}
      </h2>
    </>
  )
}

export default function LegalPage() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main>
        {/* Intro */}
        <Section className={WIDTH}>
          <Eyebrow className="mb-4">legal &amp; compliance</Eyebrow>
          <h1 className="mb-6 text-[clamp(2.2rem,5vw,3.4rem)] font-bold leading-[1.04] tracking-[-0.03em] text-foreground">
            Compliance, in <span className="text-primary">plain terms.</span>
          </h1>
          <p className="max-w-[62ch] text-[clamp(16.5px,1.7vw,18.5px)] leading-[1.6] text-muted-foreground">
            How PurserPay is built, who holds what, and why moving your own money to
            your own team stays your decision from first click to last. No jargon, no
            fine-print games — the same posture we describe to prospects, written down.
          </p>
        </Section>

        {/* 1 — Non-custodial architecture */}
        <Section band className={WIDTH}>
          <Heading
            tag="01 · non-custodial"
            title="Non-custodial architecture & disintermediation"
          />
          <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            PurserPay is software, not a financial intermediary. Our disperse contract
            is <b className="text-foreground">ownerless and immutable</b> — there are no
            admin keys, no pause switch, and no upgrade path that could let anyone,
            ourselves included, reach your capital or alter a transaction. Every payout
            is directed entirely by you and settles atomically: the full batch clears in
            a single transaction from your wallet straight to your recipients, or none of
            it does. PurserPay never holds, pools, or intermediates your funds at any
            point in the flow.
          </p>
        </Section>

        {/* 2 — Minimal-KYC billing */}
        <Section className={WIDTH}>
          <Heading
            tag="02 · minimal KYC"
            title="B2B corporate billing framework"
          />
          <p className="mb-5 max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            To issue standard commercial software invoices and license PurserPay to a
            business, we collect only what corporate billing genuinely requires:
          </p>
          <ul className="mb-5 flex flex-col gap-2.5">
            <Bullet>
              <b className="text-foreground">Legal name / entity</b> — the business being
              invoiced.
            </Bullet>
            <Bullet>
              <b className="text-foreground">Country of incorporation</b> — for
              jurisdiction and tax treatment.
            </Bullet>
            <Bullet>
              <b className="text-foreground">Tax ID</b> — the VAT / tax registration
              number.
            </Bullet>
          </ul>
          <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            That is the entire list. We do{" "}
            <b className="text-foreground">not</b> request passports, government-ID scans,
            selfies, liveness checks, or any biometric data. This is B2B billing
            information — not identity surveillance.
          </p>
        </Section>

        {/* 3 — Data dissociation & GDPR */}
        <Section band className={WIDTH}>
          <Heading
            tag="03 · data dissociation"
            title="Data dissociation & GDPR compliance"
          />
          <p className="mb-5 max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            Two tiers of data, two rules — so your identity is never tied to your payout
            activity:
          </p>
          <ul className="mb-5 flex flex-col gap-3.5">
            <Bullet>
              <b className="text-foreground">Your roster stays on your device.</b> Payee
              names, wallet addresses and amounts live only in your browser&rsquo;s local
              storage (IndexedDB). The roster is never uploaded to our servers in readable
              form — the only thing that ever leaves your browser is a transaction you
              sign yourself.
            </Bullet>
            <Bullet>
              <b className="text-foreground">Your billing PII is encrypted at rest.</b>{" "}
              Legal name, country and tax ID are stored server-side, encrypted with
              AES-256 (pgcrypto) at the database layer, and dissociated by design from any
              payout data.
            </Bullet>
          </ul>
          <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            <b className="text-foreground">Right to erasure (GDPR Art. 17):</b> a deletion
            request wipes your billing PII from our database. Your roster is already under
            your sole control, on your own device, from the very first click.
          </p>
        </Section>

        {/* 4 — On-chain risk mitigation */}
        <Section className={WIDTH}>
          <Heading
            tag="04 · sanctions screening"
            title="Automated on-chain risk mitigation"
          />
          <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            Before any batch can be signed, every recipient address is screened
            server-side against OFAC and international sanctions lists. Addresses are
            never stored in the clear: each is transformed into an{" "}
            <b className="text-foreground">irreversible salted SHA-256 hash</b> before it
            is processed or persisted. If a screened address matches a restriction list,
            the batch is blocked automatically on the backend — before your wallet is ever
            touched. There is no partial workaround: a flagged batch does not proceed.
          </p>
        </Section>

        {/* Disclaimer */}
        <Section band className={WIDTH}>
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-[14.5px] leading-[1.6] text-muted-foreground">
              This page explains how PurserPay is built; it is not legal, tax, or
              financial advice. For guidance on your specific situation, consult your own
              qualified advisor.
            </p>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  )
}
