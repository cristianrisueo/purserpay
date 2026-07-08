import type { ReactNode } from "react"

// Landing copy & demo data — single source of truth for the marketing page.
// Lifted verbatim from design-reference/PurserPay Landing.html (English).
// Kept here so copy-auditor can review all landing copy in one place.

export type Recipient = {
  name: string
  role: string
  wallet: string
  amount: string
}

export const demoTotal = "$7,440"

export const demoRecipients: Recipient[] = [
  { name: "Luna", role: "Lead", wallet: "TR7NHq…9kX2", amount: "$2,940" },
  { name: "Dayshift team", role: "Support", wallet: "TJmWv3…4pQ8", amount: "$1,600" },
  { name: "Nightshift", role: "Support", wallet: "TWd1Kp…7bL5", amount: "$1,450" },
  { name: "Marco", role: "Editor", wallet: "TQ5rYz…2nH9", amount: "$800" },
  { name: "Priya", role: "Ops", wallet: "TP8xLm…6cR3", amount: "$650" },
]

export type Problem = { n: string; title: string; body: string }

export const problems: Problem[] = [
  {
    n: "01",
    title: "The monthly rebuild",
    body: "A fresh spreadsheet every month, formulas held together by memory. Drag one cell wrong and someone is short — or paid twice.",
  },
  {
    n: "02",
    title: "The split math",
    body: "Seventy-thirty splits, bonuses, chargebacks, the one contractor on a bespoke rate. All reconciled by hand, usually late, usually tired.",
  },
  {
    n: "03",
    title: "One typo, gone",
    body: "A TRC20 address is thirty-four characters of nothing. Send to the wrong one and there's no reversal, no refund, and no one to call.",
  },
  {
    n: "04",
    title: "Hours you don't have",
    body: "Two or three hours every payday spent copying and re-checking — hours that belong to running the business.",
  },
]

export type Step = {
  n: string
  title: string
  body: string
  strongTail?: string
  highlight?: boolean
}

export const steps: Step[] = [
  {
    n: "1",
    title: "Load your team",
    body: "Import a CSV or enter them by hand — names, wallets, splits. Purser keeps the roster, so next month begins where this one left off.",
  },
  {
    n: "2",
    title: "We build & check the batch",
    body: "Every address validated on TRON, returning payees matched against last month, all splits and totals computed. Nothing to commit to until it's right.",
  },
  {
    n: "3",
    title: "You sign. Once.",
    body: "Connect your wallet, review the batch, and sign a single time. The funds move straight from you to your team. ",
    strongTail: "You sign, not us.",
    highlight: true,
  },
]

export type MoatNode = {
  label: string
  title: string
  body: string
  badge?: string
  variant?: "default" | "dashed" | "end"
}

export const moatFlow: MoatNode[] = [
  {
    label: "your wallet",
    title: "Funds sit here",
    body: "Under your control, start to finish.",
  },
  {
    label: "purser",
    title: "Builds the batch",
    body: "Checks every address. Computes every split.",
    badge: "No funds pass through",
    variant: "dashed",
  },
  {
    label: "you sign",
    title: "One signature",
    body: "Your wallet, straight to the team.",
  },
  {
    label: "team wallets",
    title: "Everyone paid",
    body: "Nothing detoured. Nothing held back.",
    variant: "end",
  },
]

export type Feature = { title: string; body: ReactNode }

export const features: Feature[] = [
  {
    title: "Whole payroll, one signature",
    body: "Approve fifty people with a single signature, instead of sending fifty transactions by hand.",
  },
  {
    title: "Address double-check",
    body: (
      <>
        <span className="font-semibold text-primary">✓</span> Valid on TRON.{" "}
        <span className="font-semibold text-primary">✓✓</span> Paid before, and
        matches last month. The costly typo is caught long before it goes out.
      </>
    ),
  },
  {
    title: "A roster that remembers",
    body: "Rates, splits and wallets set once and adjusted whenever. Each month resumes where you left off — never a blank sheet.",
  },
  {
    title: "CSV import",
    body: "Bring the sheet you already keep. Map the columns once and you're ready — no rebuilding from scratch.",
  },
  {
    title: "Receipts that hold up",
    body: "A PDF receipt for every run, each line linked to Tronscan. Clean books, clear proof of payment, no disputes.",
  },
  {
    title: "TRON / USDT native",
    body: "TRC20 USDT, end to end — the same rail your team is already paid on, without the friction.",
  },
]

export const pricingBullets: string[] = [
  "Unlimited payouts & recipients",
  "No per-transaction or volume fees",
  "Address double-check & batch builder",
  "PDF receipts with Tronscan links",
  "Non-custodial, always — you sign",
]

export type Faq = { q: string; a: string }

// NOTE: reference FAQ item 3 listed "TronLink, WalletConnect, and Ledger".
// Ledger is NOT wired in V1 (TronLink + WalletConnect only) — removed here and
// flagged in sprint_report.txt for Cristian's final call.
export const faqs: Faq[] = [
  {
    q: "Do you hold my funds?",
    a: "No — and it isn't a matter of trust. Purser is non-custodial: we build the batch, you sign it with your own wallet, and the funds go straight to your team. They never enter an account we control, so touching them simply isn't something we can do.",
  },
  {
    q: "Is this legal for me to use?",
    a: "Purser only builds and signs payment batches — the same act as sending USDT yourself, organised and checked. We don't offer legal advice, so speak with your accountant about your own situation. But moving your own money to your own team isn't something we gate.",
  },
  {
    q: "What wallets work?",
    a: "TronLink and WalletConnect. You connect your wallet, review, and sign — your keys never reach us.",
  },
  {
    q: "What if I send to a wrong address?",
    a: "That's precisely what the double-check is for. Every address is validated on TRON, and anyone you've paid before is matched against last month's records and flagged if something looks off. Nothing is signed until you've approved it.",
  },
  {
    q: "Which chains and tokens?",
    a: "TRON / USDT (TRC20) — the rail these teams are already paid on, and the one that matters to you. It's what we support today.",
  },
  {
    q: "Is my team's data private?",
    a: "Yes. Your roster — names, rates, splits — stays on your device and never leaves your browser. We see the batch you choose to build, nothing more. There's nothing to leak, because we don't store it.",
  },
]
