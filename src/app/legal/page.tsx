import type { Metadata } from "next"
import Link from "next/link"

import { Eyebrow } from "@/components/landing/Eyebrow"
import { Section } from "@/components/landing/Section"
import { SiteFooter } from "@/components/landing/SiteFooter"
import { SiteHeader } from "@/components/landing/SiteHeader"
import { DissociationFlow, NonCustodialFlow } from "./LegalDiagrams"

export const metadata: Metadata = {
  title: "Legal & compliance | PurserPay",
  description:
    "What PurserPay is and is not: non-custodial software that prepares TRON batch payments you sign yourself — never a custodian, bank, or money transmitter. Data dissociation and automated OFAC screening explained.",
}

// /legal — the trust / compliance page. Same light design system as the landing (Section /
// Eyebrow, warm off-white, aqua accent, hairline borders), wrapped in the shared SiteHeader +
// SiteFooter. This page reassures a cautious B2B buyer that PurserPay is legitimate software,
// not a money-mover: it documents precisely what PurserPay is NOT (not a custodian / bank /
// money transmitter / escrow / party in the flow of funds).
//
// TWO HARD RULES FOR THIS FILE:
//   1. English only.
//   2. No fabricated legal/regulatory claims. Only PurserPay's ACTUAL architecture is stated
//      as fact (non-custodial, ownerless/immutable disperse contract, device-local roster,
//      billing PII encrypted at rest + dissociated, real OFAC screening). Every regulatory /
//      entity / jurisdiction statement is a VISIBLE PLACEHOLDER + a greppable review marker
//      ({/* LAWYER REVIEW REQUIRED / SET / CONFIRM */}), never invented text — these go to a
//      crypto lawyer for final review.

const WIDTH = "max-w-[760px]"

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[16px] leading-[1.6] text-muted-foreground">
      <span className="mt-[2px] flex-none font-bold text-primary">✓</span>
      <span>{children}</span>
    </li>
  )
}

// "What we are NOT" marker — a calm muted ✕, never green, never alarm-red: it states a boundary,
// it is not an error.
function NotBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[16px] leading-[1.6] text-muted-foreground">
      <span className="mt-[2px] flex-none font-bold text-muted-foreground">✕</span>
      <span>{children}</span>
    </li>
  )
}

function Heading({ tag, title }: { tag: string; title: string }) {
  return (
    <>
      <Eyebrow className="mb-4">{tag}</Eyebrow>
      <h2 className="mb-5 max-w-[24ch] text-[clamp(1.5rem,2.8vw,2.05rem)] font-bold leading-[1.1] tracking-[-0.025em] text-foreground">
        {title}
      </h2>
    </>
  )
}

// A visible placeholder for a field only a lawyer can fill (entity, jurisdiction, governing
// law). Rendered in muted brackets so it reads as "to be completed", never as invented text.
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[14px] text-muted-foreground/80">[{children}]</span>
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
            What PurserPay is, in <span className="text-primary">plain terms.</span>
          </h1>
          <p className="max-w-[62ch] text-[clamp(16.5px,1.7vw,18.5px)] leading-[1.6] text-muted-foreground">
            PurserPay is software. It prepares a payment you sign yourself, from your own
            wallet, straight to your own team — we are never in the flow of funds. This page
            documents exactly who holds what, what we are and are not, and why moving your own
            money stays your decision from first click to last. No jargon, no fine-print games.
          </p>
        </Section>

        {/* 1 — What PurserPay is (and is not) */}
        <Section band className={WIDTH}>
          <Heading tag="01 · what it is" title="What PurserPay is — and is not" />
          <p className="mb-5 max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            PurserPay is self-serve software. It reads the team you load, validates every
            address, and compiles an <b className="text-foreground">unsigned</b> TRON batch
            transaction. You sign that transaction from your own wallet, and USDT moves
            straight from your wallet to your recipients. That is the whole product.
          </p>
          <div className="mb-2 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-[13px] font-semibold tracking-[0.04em] text-foreground uppercase">
                What it is
              </p>
              <ul className="flex flex-col gap-2.5">
                <Bullet>
                  <b className="text-foreground">Software tooling</b> that prepares a payment
                  for you to sign.
                </Bullet>
                <Bullet>
                  <b className="text-foreground">Directed entirely by you</b> — you choose the
                  recipients, amounts, and moment.
                </Bullet>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold tracking-[0.04em] text-foreground uppercase">
                What it is not
              </p>
              <ul className="flex flex-col gap-2.5">
                <NotBullet>
                  Not a <b className="text-foreground">custodian</b>, bank, or escrow — we
                  never hold or pool your funds.
                </NotBullet>
                <NotBullet>
                  Not a <b className="text-foreground">money transmitter</b> — funds move
                  wallet-to-wallet on-chain, never through us.
                </NotBullet>
              </ul>
            </div>
          </div>
          <NonCustodialFlow />
        </Section>

        {/* 2 — The non-custodial guarantee (technical, verifiable) */}
        <Section className={WIDTH}>
          <Heading
            tag="02 · non-custodial"
            title="The non-custodial guarantee, verifiable on-chain"
          />
          <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            Our disperse contract is{" "}
            <b className="text-foreground">ownerless and immutable</b> on the money path —
            there are no admin keys, no pause switch, and no upgrade path that could let
            anyone, ourselves included, reach your capital or alter a transaction. PurserPay
            holds no keys and cannot move your funds; every signature is produced by your own
            TRON wallet. Each payout settles atomically: the full batch clears in a single
            transaction, or none of it does. The contract is deployed on-chain and its code is
            publicly verifiable on Tronscan — you do not have to take our word for any of this.
          </p>
        </Section>

        {/* 3 — Data & privacy posture */}
        <Section band className={WIDTH}>
          <Heading
            tag="03 · data dissociation"
            title="Data dissociation & privacy posture"
          />
          <p className="mb-5 max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            Two tiers of data, two rules — so your identity is never tied to your payout
            activity:
          </p>
          <ul className="mb-5 flex flex-col gap-3.5">
            <Bullet>
              <b className="text-foreground">Your roster stays on your device.</b> Payee
              names, wallet addresses, and amounts live only in your browser&rsquo;s local
              storage (IndexedDB). The roster is never uploaded to our servers in readable
              form — the only thing that ever leaves your browser is a transaction you sign
              yourself.
            </Bullet>
            <Bullet>
              <b className="text-foreground">Your billing details are encrypted at rest.</b>{" "}
              Legal name, country, and tax ID are stored server-side, encrypted with AES-256
              (pgcrypto) at the database layer, and keyed to a one-way hash of your wallet —
              dissociated by design from any payout data.
            </Bullet>
          </ul>
          <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            To be precise about what this is and is not: dissociation is not zero-knowledge.
            The encryption key is held server-side, so PurserPay <b className="text-foreground">
            can</b> technically decrypt your billing details when it must (for example, to
            issue an invoice). What we do <b className="text-foreground">not</b> do is link
            those details to who you pay — the two are kept apart by design. Full detail,
            including your right to erasure, is in our{" "}
            <Link
              href="/privacy"
              className="font-medium text-primary underline underline-offset-2"
            >
              Privacy &amp; Cookie Policy
            </Link>
            .
          </p>
          <DissociationFlow />
        </Section>

        {/* 4 — Acceptable use */}
        <Section className={WIDTH}>
          <Heading tag="04 · acceptable use" title="Acceptable use" />
          <p className="mb-5 max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            PurserPay is neutral tooling — the equivalent of a well-made shovel. Because you
            direct every payment and sign it from your own wallet, you are responsible for the
            legality of your own payments and for your own regulatory obligations. You agree
            not to use PurserPay for any unlawful purpose, and not to attempt to interfere with
            or misuse the service.
          </p>
          {/* LAWYER REVIEW REQUIRED: acceptable-use enforceability + exact wording (prohibited-use
              list, termination rights, indemnity). Do not finalize without counsel. */}
          <p className="max-w-[64ch] text-[14.5px] leading-[1.6] text-muted-foreground/80">
            <Placeholder>
              Full acceptable-use terms pending legal review
            </Placeholder>
          </p>
        </Section>

        {/* 5 — Compliance posture (mostly placeholder — one real, factual control shown) */}
        <Section band className={WIDTH}>
          <Heading
            tag="05 · compliance"
            title="Compliance posture"
          />
          <p className="mb-5 max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
            One compliance control is built into the product today and is safe to describe
            plainly, because it is a technical fact:
          </p>
          <ul className="mb-6 flex flex-col gap-2.5">
            <Bullet>
              <b className="text-foreground">Automated sanctions screening.</b> Before any
              batch can be signed, every recipient address is screened server-side against OFAC
              and international sanctions lists. Addresses are transformed into an irreversible
              salted SHA-256 hash before processing, never stored in the clear; a match blocks
              the batch automatically, before your wallet is ever touched. There is no partial
              workaround.
            </Bullet>
          </ul>
          {/* LAWYER REVIEW REQUIRED: compliance posture. Do NOT state regulatory status,
              licenses, an AML/KYC program, transaction-monitoring claims, or entity
              classification without counsel. The visible placeholder below stands in until
              reviewed. */}
          <p className="mb-1 text-[13px] font-semibold tracking-[0.04em] text-foreground uppercase">
            Compliance information
          </p>
          <p className="max-w-[64ch] text-[14.5px] leading-[1.6] text-muted-foreground/80">
            <Placeholder>
              Regulatory classification and compliance disclosures pending legal review
            </Placeholder>
          </p>
        </Section>

        {/* 6 — Disclaimers, governing law, changes, contact */}
        <Section className={WIDTH}>
          <Heading
            tag="06 · terms & contact"
            title="Disclaimers, governing law & contact"
          />
          <div className="flex flex-col gap-5">
            <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
              <b className="text-foreground">Disclaimer of warranties & liability.</b> PurserPay
              is provided &ldquo;as is,&rdquo; without warranties of any kind. On-chain
              transactions are irreversible; you are responsible for confirming recipients and
              amounts before you sign.{" "}
              {/* LAWYER REVIEW REQUIRED: warranty disclaimer + limitation-of-liability wording. */}
              <Placeholder>
                Limitation-of-liability terms pending legal review
              </Placeholder>
            </p>
            <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
              <b className="text-foreground">Governing law & entity.</b> PurserPay is operated
              by{" "}
              {/* SET: legal operating entity — do not guess. */}
              <Placeholder>legal entity to be set</Placeholder>, and these terms are governed
              by the laws of{" "}
              {/* SET: governing law + jurisdiction — do not guess. */}
              <Placeholder>jurisdiction to be set</Placeholder>.
            </p>
            <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
              <b className="text-foreground">Changes to these terms.</b> We may update this
              page as the product evolves; material changes will be reflected here with a
              revised date.
            </p>
            <p className="max-w-[64ch] text-[16px] leading-[1.7] text-muted-foreground">
              <b className="text-foreground">Contact.</b> For legal or compliance questions,
              reach us at{" "}
              {/* CONFIRM: legal/compliance contact address. */}
              <a
                href="mailto:dorian@sailorlabs.xyz"
                className="font-medium text-primary underline underline-offset-2"
              >
                dorian@sailorlabs.xyz
              </a>
              .
            </p>
          </div>
        </Section>

        {/* Disclaimer */}
        <Section band className={WIDTH}>
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-[14.5px] leading-[1.6] text-muted-foreground">
              This page explains how PurserPay is built; it is not legal, tax, or financial
              advice. For guidance on your specific situation, consult your own qualified
              advisor.
            </p>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  )
}
