# Purser Pay — Project Context (CLAUDE.md)

Purser Pay is a **non-custodial USDT payout tool** for OnlyFans/Fansly management
agencies ("OFM agencies"). They pay their team — models, chatters, editors, remote
staff — in USDT on TRON, because banks and PayPal/Wise/Deel shut down adult-adjacent
accounts. Today they do it by hand: messy spreadsheets, manual commission-split math,
copy-pasting wallet addresses one at a time, terrified of a typo.

Purser reads their team, validates every address, computes splits, and compiles an
**unsigned batch transaction** the agency signs with their **own** wallet. The money
goes straight from the agency's wallet to their team. **Purser never touches funds,
keys, or transaction propagation.**

---

## THE ONE INVIOLABLE PRINCIPLE

**Non-custodial, always. No exceptions, ever.**

- Purser NEVER holds funds. NEVER holds keys. NEVER broadcasts a transaction.
- The app builds an unsigned batch; the client's own wallet signs and sends it.
- This is the legal moat (arm's-length, no money-transmitter license) AND the sales
  pitch. Any code, copy, or feature that breaks this is wrong by definition.

**Client data never leaves the device.** The team roster (names, addresses, amounts)
lives in the browser (IndexedDB), never on a server. There is no backend that stores
client financial data. "We don't store anything" is literally true — keep it true.

If a task ever seems to require holding funds, storing the roster server-side, or
broadcasting on the client's behalf — STOP and flag it. It's almost certainly the
wrong approach.

---

## STACK (closed — execute, don't re-litigate)

- **Frontend:** Vite + React + TypeScript. SPA. Landing at `/`, app at `/dashboard`.
  No Next, no SSR — this is a static SPA with client-side logic.
- **UI:** shadcn/ui + Tailwind + Radix. Components copied into the repo (we own them).
- **Table (the core of the app):** TanStack Table via shadcn data-table.
- **Persistence:** IndexedDB via Dexie.js. Client-side only. The roster persists here.
- **Web3:** tronweb + TronLink / WalletConnect for address validation, batch build,
  and signing. (No Ledger/WebUSB in V1.)
- **Payout contract:** our own minimal, ownerless, immutable disperse contract on TRON.
- **Billing / gate:** Stripe + one or two Vercel serverless functions (in `/api`).
  Magic-link auth (Supabase Auth `signInWithOtp`). The gate only checks "active Stripe
  sub?" — it never sees the roster or funds.
- **Deploy:** single repo, Vercel, zero infra to maintain.

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

**Phase 4 — The gate + receipts:** Stripe + magic-link, the `/api` function, PDF
receipts with Tronscan links (individual = name + date, group = "group" + date).

Ship each phase visible before starting the next. One step, see it, next.

---

## STANDING FACTS (never contradict in code or copy)

- Chain: **TRON only**, token **USDT (TRC20)**. Multichain does NOT exist yet — don't
  build for or promise Base/Arbitrum/etc.
- Wallets in V1: **TronLink + WalletConnect**. (No Ledger yet.)
- Pricing: **€249/month or €2,490/year** (2 months free).
- The disperse contract is **ours, ownerless, immutable** — not a third party's.
- The batch is **atomic**: all recipients paid in one tx, or none. No partial payout.
  Check balance ≥ sum-of-selected BEFORE enabling "Pay all"; if short, lock the button
  and say how much is missing — never silently drop payees.

---

## NOT IN V1 (YAGNI — do not build)

Multichain · Ledger/WebUSB signing · social login or username+password (magic link
only) · partial "pay until balance runs out" (atomic disperse makes it moot) ·
multi-wallet source · roles / multi-user within an agency · cross-device sync (data is
per-device by design; that's a privacy feature, not a bug) · analytics dashboards ·
any server-side storage of the roster.

If you think you need one of these, you don't — flag it to the owner first.

---

## CODE CONVENTIONS

- TypeScript strict. Prefer clarity over cleverness.
- Keep the sensitive logic (roster, addresses, amounts, batch build) fully client-side.
- Small, composable components. The table is the heart — keep its state clean.
- Don't add dependencies without reason. shadcn covers the UI; Dexie covers storage;
  tronweb covers chain. Reach for a new lib only when those genuinely can't do it.
- Never use `localStorage`/`sessionStorage` for the roster — use Dexie/IndexedDB.
