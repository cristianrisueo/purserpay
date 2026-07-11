// Landing copy & demo data — single source of truth for the marketing page.
// Restructured for the single-page IA: Manifiesto (#why) → Modules (#how) →
// Pricing (#pricing) → FAQ. Copy is calm, precise, English, sentence case.

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

// --- Bloques 1–4: the workflow modules (#how) -------------------------------

export type ModulePoint = {
  label: string
  body: string
  /** Leading verify marker: "single" = ✓, "double" = ✓✓. Absent = no marker
   *  (a descriptive technical property, not a verification status). */
  check?: "single" | "double"
}

export type Module = {
  n: string
  eyebrow: string
  title: string
  body: string
  points?: ModulePoint[]
  /** "video" renders a structural 16:9 walkthrough slot instead of points. */
  variant?: "video"
}

export const modules: Module[] = [
  {
    n: "01",
    eyebrow: "double-check",
    title: "The double-validation engine",
    body: "Every address is checked twice before a single USDT moves, so a mistyped character never becomes money you can't get back.",
    points: [
      {
        label: "Check 1 — Live on TRON",
        body: "Confirms the address is well-formed and actually exists on the TRON ledger, the moment you enter it.",
        check: "single",
      },
      {
        label: "Check 2 — Paid before",
        body: "Cross-references your own outgoing history and flags whether you've successfully paid that address in the last 90 days.",
        check: "double",
      },
    ],
  },
  {
    n: "02",
    eyebrow: "your data, your device",
    title: "CSV import, parsed on your machine",
    body: "Bring the spreadsheet you already keep. Purser maps your columns to name, address and amount right here in the browser and drops them straight into the payout table — no reformatting, no re-keying.",
    points: [
      {
        label: "100% client-side",
        body: "Every CSV record and payout amount is parsed entirely in your browser. No spreadsheet data ever leaves your machine, reaches our servers, or passes to a third party.",
      },
      {
        label: "A local sandbox",
        body: "Your roster lives only in this browser's local sandbox, on your own machine. Clearing your browser's site data and cookies wipes it permanently — it was never kept anywhere else.",
      },
    ],
  },
  {
    n: "03",
    eyebrow: "proof, on file",
    title: "A receipt for every run",
    body: "The moment a batch confirms on-chain, Purser writes an immutable receipt — timestamped, each recipient and destination hash recorded, every line linked straight to Tronscan. Clean books, clear proof of payment, no disputes.",
  },
  {
    n: "04",
    eyebrow: "watch it work",
    title: "The 3-minute walkthrough",
    body: "A short, unedited run through the whole thing — the happy path end to end, plus what an error actually looks like and how the checks catch it before anything is signed.",
    variant: "video",
  },
]

// --- Bloque 5: pricing (#pricing) — on-chain USDT ---------------------------

export type PricingTier = {
  name: string
  /** On-chain plan selector for the subscribe() call: 0 = monthly, 1 = annual. */
  plan: 0 | 1
  price: string
  unit: string
  period: string
  note?: string
  highlight?: boolean
}

export const pricingTiers: PricingTier[] = [
  {
    name: "Monthly",
    plan: 0,
    price: "150",
    unit: "USDT",
    period: "per 30 days",
    note: "Uncapped volume. Pay month to month.",
  },
  {
    name: "Annual",
    plan: 1,
    price: "1,500",
    unit: "USDT",
    period: "per 365 days",
    note: "Two months free. Fixed cost, locked in.",
    highlight: true,
  },
]

export const pricingBullets: string[] = [
  "Uncapped payout volume — move $5k or $500k",
  "0.0% app fees — no per-transaction or volume cut",
  "Address double-check & one-signature batch builder",
  "Self sovereign — your data never leaves your device",
  "Non-custodial — you sign, you hold the keys",
]

export type Faq = { q: string; a: string }

// High-conviction, AEO-ready compliance FAQ: 6 razor-sharp Q&As ordered to answer a
// non-crypto buyer's legal anxieties in sequence — custody, MSB classification, OFAC,
// roster privacy, flat-fee posture, TRON/USDT. Copy is verbatim per owner; every claim
// tracks CLAUDE.md (non-custodial, permissionless/immutable disperse with owner-only
// fee control, salted-SHA-256 screening, device-local roster, 150 USDT flat on-chain,
// TRON/USDT only).
export const faqs: Faq[] = [
  {
    q: "Does PurserPay custody funds at any point?",
    a: "No. The protocol is 100% non-custodial. The smart contract acts as an atomic router. Funds move directly from your wallet to your recipients in a single transaction. PurserPay never holds, pools, or intermediates your capital.",
  },
  {
    q: "How does this protocol avoid being classified as a Money Services Business (MSB)?",
    a: "PurserPay is immutable software infrastructure. It holds no admin keys over your money: the contract cannot pause, halt, reverse, or alter payment flows, and the payout path is permissionless. The only owner-privileged action is adjusting our flat subscription fee — it can never touch your funds or your payouts. Because we exert zero control over user capital and charge no percentage-based fees, we operate strictly as a technology provider, not a financial intermediary.",
  },
  {
    q: "How does the automated sanction screening (OFAC) filter work?",
    a: "Before any batch is signed, your recipient list is processed entirely server-side. Addresses are transformed into irreversible cryptographic hashes (SHA-256 + secret salt) and screened against international restriction lists. If a match occurs, the transaction blocks automatically on the backend before touching your wallet.",
  },
  {
    q: "Is my team's payout roster private, or is it leaked on the blockchain?",
    a: "Your payroll data is entirely private. All employee names, custom IDs, and wallet mapping are stored locally on your device via browser storage (IndexedDB). PurserPay never uploads your roster to its servers, shielding your corporate payment structure from public ledger scrapers and competitors.",
  },
  {
    q: "Why do you charge a flat subscription fee instead of volume-based percentages?",
    a: "Volume-based fees penalize your growth and alter the legal posture of our contract. We charge a flat fee of 150 USDT per month, settled transparently on-chain. This keeps the core utility free to use and ensures our relationship remains strictly that of a software service.",
  },
  {
    q: "Why does the protocol operate exclusively with USDT on the TRON network?",
    a: "Corporate operations require price stability and predictable overhead. TRON provides the deepest circulating liquidity for USDT globally alongside near-zero network energy costs, allowing mass payout batches to execute with flawless financial efficiency.",
  },
]
