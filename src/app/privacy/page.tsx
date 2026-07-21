import type { Metadata } from "next"
import Link from "next/link"

import { SiteFooter } from "@/components/landing/SiteFooter"
import { SiteHeader } from "@/components/landing/SiteHeader"

export const metadata: Metadata = {
  title: "Privacy & Cookie Policy | PurserPay",
  description:
    "How PurserPay handles data: a device-local payout roster, encrypted and dissociated billing details, transient sanctions screening, and no marketing or analytics cookies.",
}

// /privacy — a conventional, boilerplate-complete privacy & cookie policy in the existing light
// system (shared SiteHeader + SiteFooter). Numbered legal sections with sub-points.
//
// TWO HARD RULES FOR THIS FILE:
//   1. English only.
//   2. No fabricated claims. Every statement reflects PurserPay's ACTUAL architecture
//      (device-local roster; billing PII encrypted at rest + dissociated by one-way wallet
//      hash — NOT zero-knowledge, the key is server-side; salted-hashed transient OFAC
//      screening). Anything a lawyer must confirm — which privacy regimes apply, the full
//      subprocessor list, the analytics stack, the publish date, the privacy contact — is a
//      greppable review marker ({/* LAWYER REVIEW REQUIRED / SET / CONFIRM */}); known-real
//      values (contact, stack, date) are kept inline and flagged to confirm.

function Policy({
  n,
  heading,
  children,
}: {
  n: string
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-9 last:mb-0">
      <h2 className="mb-3 text-[17px] font-semibold text-foreground">
        {n}. {heading}
      </h2>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[64ch] text-[15.5px] leading-[1.7] text-muted-foreground">
      {children}
    </p>
  )
}

// A sub-point: a bold lead label followed by its body.
function Point({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="max-w-[64ch] text-[15.5px] leading-[1.7] text-muted-foreground">
      <span className="font-semibold text-foreground">{label}:</span> {children}
    </p>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[720px] px-8 py-[clamp(48px,7vw,88px)]">
        <h1 className="mb-2 text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-[-0.025em] text-foreground">
          Privacy &amp; Cookie Policy
        </h1>
        {/* SET: publish date — confirm before this page goes live. */}
        <p className="mb-8 font-mono text-[12px] tracking-[0.06em] text-muted-foreground">
          Last updated: July 2026
        </p>

        <P>
          This policy explains how PurserPay (&ldquo;we,&rdquo; &ldquo;our,&rdquo; &ldquo;the
          platform&rdquo;) handles data. PurserPay is built around data dissociation: your
          payout roster never leaves your device, and the little we do hold — your own billing
          details — is encrypted and kept apart from any payout activity.
        </P>

        <div className="mt-10">
          <Policy n="1" heading="What data we collect">
            <P>
              We run no user accounts on top of your wallet and keep no centralized store of
              your operational data. What little we collect is minimized by design.
            </P>
            <Point label="Minimal billing details">
              To invoice the software subscription, we collect three fields at pay time: legal
              name, country of incorporation, and tax ID. That is the entire list — no
              passports, ID scans, selfies, or biometric data.
            </Point>
            <Point label="Account & subscription data">
              Basic data needed to operate your subscription, such as your wallet address and
              its on-chain subscription state.
            </Point>
            <Point label="Technical logs">
              Standard server logs (for example, request metadata and error diagnostics) kept
              for security and reliability.
            </Point>
            <Point label="Roster & payout history — stays on your device">
              Every CSV file, wallet address, payee name, and payout amount is parsed and held
              strictly inside your own browser (IndexedDB). Your roster is never uploaded to us
              and never leaves your device in readable form.
            </Point>
          </Policy>

          <Policy n="2" heading="How your billing details are handled">
            <P>
              Your three billing fields are stored server-side, encrypted at rest with AES-256
              (via pgcrypto) at the database layer, and keyed to a one-way hash of your wallet.
              They are dissociated by design from any payout data, so your identity is never
              tied to who you pay.
            </P>
            <P>
              We want to be precise, because honesty here protects you: this is dissociation,
              not zero-knowledge. The encryption key is held server-side, which means PurserPay{" "}
              <b className="text-foreground">can</b> technically decrypt your billing details
              when it must — for instance, to issue an invoice. We do not claim we are unable to
              read them. What we do <b className="text-foreground">not</b> do is link them to
              your payout activity.
            </P>
          </Policy>

          <Policy n="3" heading="What we do not — and cannot — see">
            <Point label="Your roster and payment history">
              These live only in your browser. We never receive them, so we cannot see who you
              pay, how much, or how often.
            </Point>
            <Point label="Your keys and funds">
              We never collect, store, or access your private keys, seed phrases, or funds. All
              on-chain actions are signed directly by your own TRON wallet.
            </Point>
          </Policy>

          <Policy n="4" heading="Cookies & browser storage">
            <P>
              We use native browser storage rather than tracking cookies.{" "}
              {/* CONFIRM: analytics stack — this page asserts NO marketing/analytics cookies.
                  Confirm no analytics tooling is deployed before publish. */}
              We deploy no marketing, analytics, or third-party profiling cookies.
            </P>
            <Point label="Functional storage">
              Your roster and active distribution tables live in your browser&rsquo;s
              IndexedDB. Small technical values — wallet-connection state and interface
              preferences — may use localStorage or a strictly functional session cookie. None
              of it is transmitted to us.
            </Point>
            <Point label="Your control">
              This data is entirely user-controlled. Clearing your browser&rsquo;s site data,
              cache, or cookies permanently destroys all local records.
            </Point>
          </Policy>

          <Policy n="5" heading="Server-side processing">
            <Point label="Sanctions screening">
              Before a batch can be signed, destination addresses are screened server-side
              against OFAC and international sanctions lists. Each address is salted-hashed and
              checked transiently; addresses are not stored in the clear or tied to your
              identity, and a match blocks the batch.
            </Point>
            <Point label="Public ledger">
              Once you sign, the transaction is routed to public TRON nodes. On-chain data
              (recipient addresses, amounts, block timestamps) is inherently public and
              immutable by the nature of distributed ledgers — this is outside our control.
            </Point>
          </Policy>

          <Policy n="6" heading="Data sharing & processors">
            <P>
              <b className="text-foreground">We do not sell your data.</b> We share it only with
              the infrastructure providers strictly needed to run the service, under their
              standard data-processing terms.
            </P>
            {/* CONFIRM: full subprocessor list before publish — this names hosting (Vercel) and
                database (Supabase); confirm these and add any others actually in use. */}
            <Point label="Processors we use">
              Cloud hosting and application infrastructure (Vercel) and managed database
              infrastructure (Supabase). These process data on our behalf to operate the
              platform; they do not receive your device-local roster.
            </Point>
          </Policy>

          <Policy n="7" heading="Your rights & data control">
            <P>
              You hold control over your data.{" "}
              {/* LAWYER REVIEW REQUIRED: confirm which privacy regimes apply (e.g. GDPR / others)
                  and the precise rights + response timelines to assert. Do not state that a
                  specific regime governs us without review. */}
              Where applicable data-protection law grants you rights of access, rectification,
              and erasure, we honor them as follows:
            </P>
            <Point label="Your roster">
              Device-local and under your sole control — erase it any time by clearing your
              browser&rsquo;s site data.
            </Point>
            <Point label="Your billing details">
              You may request erasure at any time; on request we permanently wipe your encrypted
              billing record from our database.
            </Point>
          </Policy>

          <Policy n="8" heading="Contact">
            <P>
              {/* CONFIRM: privacy-requests contact address. */}
              For privacy requests or data-protection questions, contact us at{" "}
              <a
                href="mailto:dorian@sailorlabs.xyz"
                className="font-medium text-primary underline underline-offset-2"
              >
                dorian@sailorlabs.xyz
              </a>
              . For how the product is built and the non-custodial guarantee, see our{" "}
              <Link
                href="/legal"
                className="font-medium text-primary underline underline-offset-2"
              >
                Legal &amp; compliance
              </Link>{" "}
              page.
            </P>
          </Policy>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
