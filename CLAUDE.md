# PurserPay — Project Context (CLAUDE.md)

PurserPay is a **non-custodial, no-KYC USDT payout tool** for de-banked businesses
that pay a distributed team — remote staff, contractors, freelancers — in USDT on
TRON, because banks and PayPal/Wise/Deel shut down their accounts for operating in
gray-area or adult-adjacent industries. Today they do it by hand: messy spreadsheets,
manual commission-split math, copy-pasting wallet addresses one at a time, terrified
of a typo.

Purser reads their team, validates every address, computes splits, and compiles an
**unsigned batch transaction** the business signs with their **own** wallet. The
money goes straight from their wallet to their team. **Purser never touches funds,
keys, or transaction propagation.**

**Public narrative vs. distribution channel:** the public brand, landing page, and
app copy are vertical-agnostic — never name "OnlyFans," "OFM," or any specific
industry. Copy speaks to the pain (de-banked, distributed team, fat-finger fear,
privacy, one signature), not the vertical. This does NOT change go-to-market: cold
outreach and demos still target OFM (OnlyFans/Fansly management) agencies
specifically — OFM remains the primary **distribution channel**, just not the public
brand.

---

## THE ONE INVIOLABLE PRINCIPLE

**Non-custodial, always. No exceptions, ever.**

- Purser NEVER holds funds. NEVER holds keys. NEVER broadcasts a transaction.
- The app builds an unsigned batch; the client's own wallet signs and sends it.
- This is the legal moat (arm's-length, no money-transmitter license) AND the sales
  pitch. Any code, copy, or feature that breaks this is wrong by definition.

This is Tier 1 and it is absolute — the server-side architecture below changes
nothing about it. Purser gains a backend to hide API keys, screen for OFAC, and gate
the subscription; it never gains custody of funds, keys, or broadcast.

**Data dissociation — we store nothing we can read.** Two tiers of data, two rules:

- The **team roster** (payee names, addresses, amounts) stays **device-local**
  (IndexedDB). It is never sent to a server in readable form — the batch the client
  chooses to build is the only thing that ever leaves the browser, and it leaves as a
  transaction they sign themselves.
- The **account holder's own PII** (name, country, tax ID) plus auth and subscription
  state persist in **Supabase, encrypted at rest (pgcrypto AES-256)**. Wallet
  addresses touched for OFAC screening are **salted-SHA-256 hashed** before any
  persistence. Purser stores nothing it can read, and nothing that ties a person to
  their payouts.

If a task ever seems to require holding funds/keys, broadcasting on the client's
behalf, storing the **roster** server-side, or storing **readable** PII — STOP and
flag it. Encrypted/hashed dissociation is the only server storage ever allowed.

> Note: the landing copy has been reconciled to the dissociation story — it now says the
> **money never leaves your wallet** and the **roster never leaves your device**, not the
> old absolute "your data never leaves your machine." Remaining non-landing assertions
> are still queued — see **Pending Post-Migration Reconciliation** at the end.

---

## STACK (closed — execute, don't re-litigate)

> Migration status: the repo is still Vite today. The Next.js + Supabase port is the
> active infra task. During it, **zero design/copy drift** — the ported app must be
> 1:1 with the current build (see the Migration Phase below and both auditors).

- **Frontend:** Next.js (App Router) + React + TypeScript, deployed on Vercel (was a
  Vite SPA). Landing at `/`, app at `/dashboard`. Server components, route handlers,
  and Edge middleware carry the server-side logic — hiding API keys, enforcing OFAC.
  The public landing is a single page — **Why us (`#why`) → How it works (`#how`) →
  Pricing (`#pricing`) → FAQ** — with a **dynamic 3-state wallet CTA** in the nav
  (Connect wallet → Activate subscription → Go to dashboard) that reads state via the
  shared `lib/tron/wallet.ts` + `subscription.ts` and routes the subscribe flow to the
  dashboard. **How it works** runs Modules 01–03 on one symmetric 50/50 rhythm (copy
  left, cards/receipt-preview right) with a 16:9 walkthrough slot as 04. The **Pricing**
  section's own **Subscribe** button is the exception: it subscribes **inline** — connect
  the wallet if needed, then `runSubscribe` from the user's own wallet (fail-closed with a
  calm "not deployed yet" until the contract ships). NOTE: only the flat monthly
  `subscribe()` / 250-USDT path exists on-chain; the Annual tier is selection + display
  until an annual contract method is added (a contract change — out of V1 scope, flag
  first). Landing and dashboard stay 100% separated; **design tokens are unchanged**.
- **UI:** shadcn/ui + Tailwind + Radix. Components copied into the repo (we own them).
- **Table (the core of the app):** TanStack Table via shadcn data-table.
- **Persistence — two tiers:**
  - **Roster:** IndexedDB via Dexie.js. Device-local, client-side only. Never leaves
    the browser in readable form. (Unchanged from V1.)
  - **Account + compliance:** Supabase (Postgres) holds the account holder's encrypted
    PII (pgcrypto AES-256), auth, and subscription state, plus salted-hashed
    OFAC-screening data. The server never receives the roster.
- **Web3:** tronweb + TronLink / WalletConnect for address validation, batch build,
  and signing. (No Ledger/WebUSB in V1.)
- **Payout contract:** our own minimal, ownerless, immutable disperse contract on TRON.
- **Billing / gate:** an **on-chain subscription smart contract** — 250 USDT/mo or
  2,500 USDT/yr (2 months free), paid on-chain. **No Stripe, no card, no fiat.** The
  gate checks "active on-chain subscription?" via a Vercel route handler; magic-link
  auth (Supabase Auth `signInWithOtp`) stays. The gate never sees the roster or funds.
- **Deploy:** single repo, Vercel (Next.js runtime + serverless / edge functions).

### Design tokens (match the landing exactly)

- Accent (aqua): `#0FB5C9`
- Background (warm off-white): `#FAF9F7`
- Surface (white): `#FFFFFF`
- Ink (near-black): `#111014`
- Muted text: `#615C57`
- Hairline / border: `#E5E2DD`
- Success ("paid" rows only): `#2F9E6B`
- Type: **Inter Tight** throughout. Sentence case. NOT uppercase-condensed.
- Radii: soft, 10–14px. Subtle warm shadows allowed. Flat, clean, modern SaaS.

---

## LEGAL & COMPLIANCE GUARDRAILS (the reason a server exists at all)

Purser runs a backend for exactly four reasons: hide API keys, enforce OFAC, gate the
on-chain subscription, and hold encrypted account PII. It still never touches funds,
keys, broadcast, or the roster.

- **OFAC / sanctions screening.** Recipient addresses are screened server-side against
  the OFAC SDN / sanctions list before a batch can be built or signed. The list and
  the screening keys stay server-side (never shipped to the client). Any address
  persisted for screening is salted-SHA-256 hashed, never stored in the clear. A
  flagged address blocks the batch — no partial workaround.
- **GDPR — dissociation + Art. 17 erasure.** Account-holder PII (name, country, tax
  ID) is encrypted at rest with pgcrypto (AES-256); wallets are salted-hashed. The
  schema dissociates identity from payout activity by design. A "right to erasure"
  request wipes the account's PII from Supabase; the roster is already device-local, so
  it is under the user's control from the start.
- **Secrets discipline.** API keys, the OFAC feed, and any service credentials live
  server-side only. Nothing sensitive is ever bundled into client code.

---

## THE 3 LAWS OF UX (this is the moat — non-negotiable)

Anyone can copy the features. What they can't copy is an agency owner opening this
tired at 11pm and **not being afraid of screwing up**. That's the product.

1. **≤ 3 clicks for any action.** If a task needs more, the design is wrong. Fix the
   design, don't ship the friction.
2. **Zero fear.** The checks scream the state: ✓ valid on TRON, ✓✓ paid before / matches
   last month, green = paid, button locked if balance won't cover. The user never
   wonders if they're about to make a mistake — the system won't let them.
3. **Beauty = trust.** It's real money, other people's money. Ugly reads as scam.
   Clean, calm, cared-for is what makes someone sign a $50k batch without sweating.

---

## BUILD PHASES (in order — frontend first, per owner decision)

Phases 1–4 are the original **Vite-v1** build record. Phases 1–3 shipped; Phase 4's
gate was never built under Vite and is now re-specified on-chain inside the Migration
Phase. Kept here for history — read them as "what V1 was."

**Phase 1 — The shell (start here, MOCK data, zero web3):**
Vite + React + TS, shadcn with the custom theme, `/dashboard` route, and the central
table with TanStack Table: columns `[checkbox | name | address | USDT | status]`,
mock rows, all checked by default, a "Pay all" button + per-row pay button, a row
"paid" (green) state, and a reset button that clears the greens. Navigable and pretty,
nothing signs anything yet.

**Phase 2 — Dexie:** wire IndexedDB. Import a CSV → persist → reload → table
pre-loads from storage. Overwrite on re-import (`.clear()` + reload). Editable rows
(add / edit / remove — never destroy a payee just because balance won't cover).

**Phase 3 — Web3:** tronweb, real TRON address validation, the double-check (✓ / ✓✓),
connect wallet, read USDT balance, build the unsigned batch, the disperse flow
(`approve` once → `disperse` one signature per batch), paint rows green on-chain
confirm.

**Phase 4 — The gate + receipts (superseded):** originally Stripe + magic-link + an
`/api` function. Billing is now on-chain (no Stripe) — folded into the Migration
Phase. PDF receipts with Tronscan links (individual = name + date, group = "group" +
date) still stand.

Ship each phase visible before starting the next. One step, see it, next.

---

## MIGRATION PHASE — Vite → Next.js + Supabase + compliance (current)

The active infra work. Order matters; each step ships visible and verified before the
next.

1. **Port the frontend 1:1.** Move the Vite SPA to Next.js (App Router) with **zero
   design or copy drift** — the ported app must render and read identically to the
   current build. This is a plumbing move, not a redesign. (Both auditors verify parity.)
2. **Stand up Supabase.** Account-holder PII encrypted at rest (pgcrypto AES-256), auth
   (magic-link, `signInWithOtp`), subscription state. The roster stays in Dexie.
3. **OFAC middleware.** Server-side recipient screening before a batch can be built;
   salted-hashed persistence only; a hit blocks the batch.
4. **On-chain subscription.** Swap the billing gate to the subscription smart contract
   (250 USDT/mo or 2,500 USDT/yr). Retire Stripe entirely.
5. **Post-migration copy reconciliation.** Only after the port is verified 1:1, open a
   dedicated copy pass to update the frozen landing lines (see Pending Reconciliation).

---

## STANDING FACTS (never contradict in code or copy)

- Chain: **TRON only**, token **USDT (TRC20)**. Multichain does NOT exist yet — don't
  build for or promise Base/Arbitrum/etc.
- Wallets in V1: **TronLink + WalletConnect**. (No Ledger yet.)
- Pricing: **250 USDT/month or 2,500 USDT/year** (2 months free), paid **on-chain via
  smart contract** — no fiat, no card, no Stripe.
- Storage: the **roster stays device-local** (IndexedDB); **account-holder PII is
  stored server-side encrypted** (pgcrypto AES-256 — dissociation); recipient addresses
  are salted-hashed for OFAC. Purser stores nothing it can read.
- The disperse contract is **ours, ownerless, immutable** — not a third party's.
- The batch is **atomic**: all recipients paid in one tx, or none. No partial payout.
  Check balance ≥ sum-of-selected BEFORE enabling "Pay all"; if short, lock the button
  and say how much is missing — never silently drop payees.

---

## NOT IN V1 (YAGNI — do not build)

Multichain · Ledger/WebUSB signing · social login or username+password (magic link
only) · partial "pay until balance runs out" (atomic disperse makes it moot) ·
multi-wallet source · roles / multi-user within an agency · cross-device **roster**
sync (the roster is per-device by design — a privacy feature, not a bug; account and
subscription state do live server-side, but the roster never does) · analytics
dashboards · any server-side storage of the **roster** (encrypted account PII lives
server-side; the roster does not).

If you think you need one of these, you don't — flag it to the owner first.

---

## CODE CONVENTIONS

- TypeScript strict. Prefer clarity over cleverness.
- **Keep the roster client-side.** The roster, addresses, amounts, and batch build stay
  fully client-side (Dexie/IndexedDB). Only encrypted account PII, OFAC screening, and
  subscription gating run server-side — and server code must never receive the roster
  in readable form.
- **Secrets stay server-side.** API keys, the OFAC feed, and service credentials live
  server-side only, never bundled into client code. PII columns use pgcrypto (AES-256);
  wallet addresses are salted-hashed before any persistence.
- **Zero-drift migration.** During the Vite → Next.js port, design tokens, Tailwind
  classes, layout, and copy do not change — the ported app is 1:1 with the current
  build. Improvements wait for a dedicated post-migration pass.
- Small, composable components. The table is the heart — keep its state clean.
- Don't add dependencies without reason. shadcn covers the UI; Dexie covers the
  device-local roster; Supabase covers account/compliance storage; tronweb covers
  chain. Reach for a new lib only when those genuinely can't do it.
- Never use `localStorage`/`sessionStorage` for the roster — use Dexie/IndexedDB.
- **Write a descriptive `sprint_report.txt` after every major task** (what changed,
  decisions, guardrails honored, blockers, verification).

---

## PENDING POST-MIGRATION RECONCILIATION

Deliberate, temporary divergence: the **governance facts above are the source of truth
now**, but the **live app copy is frozen** during the migration (zero drift). These
lines still reflect the old model and must be reconciled in a dedicated copy pass
**after** the Next.js port is verified 1:1 — not before:

**Reconciled in the landing restructure sprint (done):**
- `src/components/landing/Hero.tsx` — now "your money never leaves your wallet; your
  roster never leaves your device" (the dissociation story), replacing the old absolute
  "Your data never leaves your machine."
- `src/components/landing/content.tsx` (privacy FAQ) — reconciled to the same
  device-local roster framing; no blanket "we don't store it."
- `src/components/landing/PricingSection.tsx` — now **250 / 2,500 USDT, on-chain** (no
  fiat, no card), replacing €249 / €2,490.

**Still pending (non-landing — the freeze stands until their own pass):** the
device-local assertions in `EmptyRoster.tsx`, `lib/db.ts`, `lib/receipts.ts`,
`lib/tron/validation.ts`. Auditors flag these as pending; they do not edit them.
