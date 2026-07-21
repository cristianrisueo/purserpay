// Landing copy & demo data — single source of truth for the marketing page.
// Restructured for the single-page IA: Manifiesto (#why) → Modules (#how) →
// Pricing (#pricing) → FAQ. Copy is calm, precise, English, sentence case.

export type Recipient = {
  name: string
  /** Display-ready truncated address (marketing mock — never a real wallet). */
  wallet: string
  amount: string
  /** Mockup pre-flight line — mirrors the real dashboard's closed row-state model
   *  (src/lib/security/preflightView.ts): `paid-before` = ✓✓ green · `valid` = ✓ aqua ·
   *  `frozen` = red block that REPLACES the line and disables Pay. */
  line: "paid-before" | "valid" | "frozen"
  /** Orthogonal amber "Exchange?" advisory — the "Valid on TRON" line still shows
   *  alongside it. Never set on a frozen row. */
  exchange?: boolean
}

// The batch total shown in the hero card footer = the SELECTED rows only
// (400 + 600 + 300). The frozen row (Aaron, 100) is unchecked, so it is excluded — see below.
export const demoTotal = "1,300"

// The hero's payout card is a FAITHFUL, STATIC replica of the real dashboard pre-flight
// (HERO-1): the exact security states the app produces — a paid-before row (✓✓ green), clean
// "Valid on TRON" rows (✓ aqua), one exchange advisory (amber), and one Tether-frozen row (red)
// that blocks its own Pay. Four rows cover the full caustic; the frozen row is rendered
// UNCHECKED (as an operator would leave a blocked row) so "Pay all" is legitimately active over
// the three clean rows — mirroring the live app, where blockedCount/selectedSum/the pre-flight
// summary are all computed over SELECTED rows (usePayout.ts). demoTotal is that selected sum
// (1,300); the unchecked frozen 100 is not counted. Names only — no role (ROLE-1). Consumed only
// by HeroPayoutCard now (Module 03's visual has its own two-sided mock data, below).
export const demoRecipients: Recipient[] = [
  { name: "Marcus Bell", wallet: "TXRq2A…tVPBi", amount: "400", line: "paid-before" },
  { name: "Devin Cole", wallet: "TKtoPD…7LJMY", amount: "600", line: "valid" },
  { name: "Rachel Nguyen", wallet: "TNXoiA…Xc32G", amount: "300", line: "valid", exchange: true },
  { name: "Aaron Wells", wallet: "TGwoyc…pDZRg", amount: "100", line: "frozen" },
]

// --- Module 03 mock data (#how — "The same proof, on both sides") -----------
// Two decorative mocks (never real wallets): the SAME confirmed payout seen from the agency
// (dashboard post-pay) and from a payee (/portal receipts). ProofBothSides.tsx renders these;
// the structural, app-mirroring strings (labels/headers/footers) stay inline in that component,
// same split as HeroPayoutCard. Amounts stay in hundreds/thousands (never sandbox-scale).

// Agency side — one July batch, every row paid. Names/addresses reuse the hero rows for
// cross-page coherence (here all in the paid state, since this is the post-payout view).
export type ProofAgencyRow = { name: string; wallet: string; amount: string }
export const proofAgencyRows: ProofAgencyRow[] = [
  { name: "Marcus Bell", wallet: "TXRq2A…tVPBi", amount: "400" },
  { name: "Devin Cole", wallet: "TKtoPD…7LJMY", amount: "600" },
  { name: "Rachel Nguyen", wallet: "TNXoiA…Xc32G", amount: "300" },
]

// Payee side — ONE payee's own history across months, from a distinct agency payer wallet (not
// one of the recipient rows above, so it never reads as a payee paying itself). Coherent
// hundreds/thousands; staggered monthly dates read as a real payment record, not test data.
export type ProofPayeeReceipt = { amount: string; from: string; date: string }
export const proofPayeeReceipts: ProofPayeeReceipt[] = [
  { amount: "400", from: "TWpb9C…4mK7Z", date: "21 Jul 2026" },
  { amount: "600", from: "TWpb9C…4mK7Z", date: "21 Jun 2026" },
  { amount: "1,200", from: "TWpb9C…4mK7Z", date: "21 May 2026" },
]

// --- Hero benefits checklist (#why, left column) ----------------------------

export type HeroBenefit = {
  /** Bold lead line, rendered beside the aqua ✓✓ mark. */
  title: string
  /** The supporting sentence beneath the title. */
  body: string
}

// The five benefits shown as an aqua ✓✓ checklist in the hero (HERO-1 revision). FIDELITY RULE
// (owner-enforced): every claim maps to a feature the app SHIPS today — the pre-flight address
// checks (S-1/S-3), the device-local Dexie roster + one-button wipe, the self-declared PII taken
// at pay time, the affiliate receipt portal (view/PDF/on-chain verify) plus the dashboard record,
// and the flat on-chain subscription with no volume cut. Copy is owner-approved, verbatim.
export const heroBenefits: HeroBenefit[] = [
  {
    title: "Your payouts are safe by default.",
    body: "Before you sign, we check every address for Tether-frozen wallets, duplicate entries, exchange-deposit addresses, and invalid formats.",
  },
  {
    title: "Everything stays in your browser.",
    body: "Your roster and payment history live in a local database on your device. No data leaves your machine, and one button wipes it all.",
  },
  {
    title: "Anonymous by design — minimal KYC, completed in under a minute.",
    body: "Just name, country, and tax ID at pay time.",
  },
  {
    title: "Your payees get their own receipts.",
    body: "Each recipient opens an anonymous link to view, download (PDF), and on-chain-verify every payment you sent them — and you get a full record of every payout in your dashboard.",
  },
  {
    title: "One flat subscription — never a cut of your volume.",
    body: "Monthly or yearly, one price. We never take a percentage of what you send.",
  },
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
    title: "The same proof, on both sides.",
    body: "The moment a batch confirms on-chain, PurserPay writes an immutable receipt — timestamped, each recipient linked to its Tronscan hash. You get a clean report for your books. Your payees open one anonymous link to view, download, and on-chain-verify every payment you sent them. Same on-chain truth, two views — no “did you pay me?”, no disputes.",
  },
  {
    n: "04",
    eyebrow: "watch it work",
    title: "The walkthrough",
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
