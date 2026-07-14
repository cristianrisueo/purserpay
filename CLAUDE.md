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

## ARCHITECTURAL SOURCE OF TRUTH — `docs/`

**The [`docs/`](./docs) folder is the architectural source of truth for this project.
Consult it BEFORE proposing or making any structural / architectural change** — anything
touching the money path, the compliance/encryption flow, the smart contract, the data
model, or the deploy/network configuration. Start at [`docs/README.md`](./docs/README.md);
it indexes six topic docs (architecture, non-custodial, data-flow, compliance & encryption,
smart contract, deployment) and an invariants cheat-sheet, each anchored to real file paths.

Rules for using it:

- **This file (`CLAUDE.md`) governs product philosophy, copy, and standing facts; `docs/`
  governs the *technical architecture*.** They cross-reference each other. When both speak
  to a point, they must agree — reconcile, don't contradict.
- **The code is authoritative over both.** If a doc conflicts with the source, the source
  wins — cross-check the referenced file before acting on a doc claim.
- **Keep them in lockstep.** Any change that alters behavior `docs/` describes must update
  the relevant doc in the SAME change. A stale doc is a bug.

---

## THE ONE INVIOLABLE PRINCIPLE

**Non-custodial, always. No exceptions, ever.**

- Purser NEVER holds funds. NEVER holds keys. NEVER broadcasts a transaction.
- The app builds an unsigned batch; the client's own wallet signs and sends it.
- This is the legal moat (arm's-length, no money-transmitter license) AND the sales
  pitch. Any code, copy, or feature that breaks this is wrong by definition.
- The PurserPay contract's owner surface is **monetization only, never custody**: adjusting
  the two subscription-fee amounts (`updateSubscriptionFees`) and redirecting the treasury
  that receives **our own** subscription fee (`updateTreasuryWallet` — so revenue can move to
  cold/multisig without a redeploy that would wipe every subscriber's on-chain expiry), plus
  `transferOwnership`. `treasuryWallet` only ever *receives* our fee — `disperse()` never
  references it — so redirecting it can never touch user funds. The owner can never touch
  funds, keys, broadcast, pause anything, or alter the permissionless `disperse` path.
  Non-custodial is untouched by it. (`usdt` stays immutable — changing the token would break
  every standing approval.)

This is Tier 1 and it is absolute — the server-side architecture below changes
nothing about it. Purser gains a backend to hide API keys, screen for OFAC, and gate
the subscription; it never gains custody of funds, keys, or broadcast.

**Data dissociation — we store nothing we can read.** Two tiers of data, two rules:

- The **team roster** (payee names, addresses, amounts) stays **device-local**
  (IndexedDB). It is never sent to a server in readable form — the batch the client
  chooses to build is the only thing that ever leaves the browser, and it leaves as a
  transaction they sign themselves.
- The **account holder's own PII** (name, country, tax ID) persists in **Supabase,
  encrypted at rest (pgcrypto AES-256)**; the free-tier quota and referral credit persist as
  **salted-hashed, no-PII rows**; wallet addresses touched for OFAC screening are
  **salted-SHA-256 hashed** before any persistence. (Subscription state is **on-chain**, read
  live — NOT stored in Supabase; magic-link auth is the chosen method but not yet wired.)
  Purser stores nothing it can read, and nothing that ties a person to their payouts.

If a task ever seems to require holding funds/keys, broadcasting on the client's
behalf, storing the **roster** server-side, or storing **readable** PII — STOP and
flag it. Encrypted/hashed dissociation is the only server storage ever allowed.

> Note: the landing copy has been reconciled to the dissociation story — it now says the
> **money never leaves your wallet** and the **roster never leaves your device**, not the
> old absolute "your data never leaves your machine." Remaining non-landing assertions
> are still queued — see **Pending Post-Migration Reconciliation** at the end.

---

## STACK (closed — execute, don't re-litigate)

> Migration status: the Vite → Next.js + Supabase port is **DONE** — this repo IS Next.js 15
> (App Router, route handlers, server actions), with Supabase compliance, OFAC screening, the
> on-chain subscription, the free tier, and the referral loop all shipped. The one-time
> zero-drift port is complete; improvements now ship normally. One caveat: magic-link auth
> (`signInWithOtp`) is the chosen method but is **NOT yet wired** — the dashboard is gated by
> wallet connection + on-chain entitlement, not an auth session. See the Migration Phase below.

- **Frontend:** Next.js (App Router) + React + TypeScript, deployed on Vercel (was a
  Vite SPA). Landing at `/`, app at `/dashboard`. Server components, route handlers,
  and Edge middleware carry the server-side logic — hiding API keys, enforcing OFAC.
  The public landing is a single page — **Why us (`#why`) → How it works (`#how`) →
  Pricing (`#pricing`) → FAQ** — with a **dynamic 3-state wallet CTA** in the nav
  (Connect Wallet → Go to Dashboard) that **re-reads wallet state
  silently on mount** (via `getAddress()` — never a connect prompt on load) using the
  shared `lib/tron/wallet.ts` + `subscription.ts`, shows a neutral resolving state so a
  connected user never flashes "Connect Wallet", and routes into the dashboard: an
  unsubscribed-but-connected wallet ("Go to Dashboard") lands in **free mode**, a subscribed
  one goes straight in. **How it works** runs Modules 01–03 on one symmetric 50/50 rhythm (copy
  left, cards/receipt-preview right) with a 16:9 walkthrough slot as 04. The **Pricing**
  section's own **Subscribe** button is the exception: it subscribes **inline** — connect
  the wallet if needed, then `runSubscribe` from the user's own wallet (fail-closed with a
  calm "not deployed yet" until the contract ships). The on-chain `subscribe(uint8 planType)`
  supports **both** plans — `0` = monthly (150 USDT / 30 days), `1` = annual
  (1,500 USDT / 365 days) — and both are signed from the landing Pricing section **and** the
  dashboard subscribe modal, which now carries a plan selector (opening on **monthly** by
  default, since the payment is on-chain and irreversible; the landing opens it on the card
  the user picked). Only the two fee amounts and the treasury destination are owner-adjustable
  (`updateSubscriptionFees` / `updateTreasuryWallet`). Landing and dashboard stay
  100% separated; **design tokens are unchanged**.
- **UI:** shadcn/ui + Tailwind + Radix. Components copied into the repo (we own them).
- **Table (the core of the app):** TanStack Table via shadcn data-table.
- **Persistence — two tiers:**
  - **Roster:** IndexedDB via Dexie.js. Device-local, client-side only. Never leaves
    the browser in readable form. (Unchanged from V1.)
  - **Account + compliance:** Supabase (Postgres) holds the account holder's encrypted
    PII (pgcrypto AES-256), the free-tier quota, and referral credit — plus salted-hashed
    OFAC-screening data. It does **not** hold auth (not yet wired) or subscription state
    (that's on-chain, read live). The server never receives the roster.
- **Web3:** tronweb + TronLink / WalletConnect for address validation, batch build,
  and signing. (No Ledger/WebUSB in V1.)
- **Payout contract:** our own minimal disperse contract on TRON — the `disperse` path is
  **permissionless and immutable** (no owner gate, no fee, holds nothing). The unified
  PurserPay contract adds owner-only levers over the **subscription fees**
  (`updateSubscriptionFees`) and the **treasury destination** (`updateTreasuryWallet`, so our
  own revenue can move to cold/multisig without a redeploy); neither lever ever touches funds,
  keys, broadcast, or disperse, and `treasuryWallet` only ever receives our own fee.
- **Billing / gate:** an **on-chain subscription smart contract** — 150 USDT/mo or
  1,500 USDT/yr (2 months free), paid on-chain, **owner-adjustable** (not a redeploy, not a
  proxy). **No Stripe, no card, no fiat.** The gate (a Vercel route handler,
  `/api/payout/authorize`) first **proves wallet control** — a single-use signature challenge
  (`GET /api/payout/challenge` → `signMessageV2`; the server recovers the signer and asserts it
  equals the payer **before** any quota/credit is touched, so a spoofed public address can't
  consume a customer's free slot or burn a credit month) — then authorizes on **entitlement = an
  active on-chain subscription OR off-chain referral credit**; with neither, a **free tier** (1
  payee / 30 days) applies. That signature challenge is **wallet-control proof, NOT an auth
  session** (no session, no identity). Magic-link auth (Supabase `signInWithOtp`) remains the
  chosen *account*-auth method but is **not yet wired** — the dashboard is gated by wallet
  connection + on-chain entitlement. The gate never sees the roster or funds.
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

## MIGRATION PHASE — Vite → Next.js + Supabase + compliance (SHIPPED)

Kept as the record of what was built and in what order. Status: steps 1, 3, 4 **shipped**;
step 2 shipped **except magic-link auth, which is not yet wired** (deferred); step 5 (the copy
pass) is the only open item, now **unblocked** (the port is verified 1:1).

1. **Port the frontend 1:1.** ✅ SHIPPED. Vite SPA → Next.js (App Router) with zero design/copy
   drift — the ported app renders and reads identically. A plumbing move, not a redesign.
2. **Stand up Supabase.** ✅ mostly SHIPPED — PII encrypted at rest (pgcrypto AES-256) +
   compliance/free-tier/referral tables. ⚠️ **auth (magic-link, `signInWithOtp`) is NOT yet
   wired**; the current gate is wallet connection + on-chain entitlement. Subscription state is
   **on-chain** (not a Supabase table). The roster stays in Dexie.
3. **OFAC middleware.** ✅ SHIPPED. Server-side recipient screening before a batch can be built;
   salted-hashed persistence only; a hit blocks the batch.
4. **On-chain subscription.** ✅ SHIPPED. The billing gate is the subscription smart contract
   (150 USDT/mo or 1,500 USDT/yr). Stripe never existed here; nothing to retire.
5. **Post-migration copy reconciliation.** ⏳ OPEN (now unblocked). Open a dedicated copy pass to
   update the frozen non-landing lines (see Pending Reconciliation — the landing is already done).

---

## STANDING FACTS (never contradict in code or copy)

- Chain: **TRON only**, token **USDT (TRC20)**. Multichain does NOT exist yet — don't
  build for or promise Base/Arbitrum/etc. The network (`mainnet | nile`) is selected at
  **build time** by `NEXT_PUBLIC_TRON_NETWORK` — `config.ts` holds both blocks and **throws**
  if the var is missing/unrecognized (fail closed). There is **no runtime network toggle** (it
  would desync the client from `serverRead.ts` and let sandbox traffic write into the one
  production Supabase project); network isolation comes from a **separate deployment**
  (prod=mainnet / sandbox=nile, separate Vercel envs + separate Supabase projects). Non-mainnet
  builds show a persistent SANDBOX banner. The contract is **deployed on both networks**
  (mainnet `TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha`, nile `TK9z7J4TZBB5UjaFmE8kvNDehdAJFecUnX`) and
  the mainnet address is wired into `config.ts`; the **production Vercel env flip
  (`NEXT_PUBLIC_TRON_NETWORK=mainnet`) is still pending**, so customers are not on mainnet yet.
  Mainnet script deploys/reads **require `TRON_PRO_API_KEY`** (keyless mainnet calls 429).
- Wallets in V1: **TronLink + WalletConnect**. (No Ledger yet.)
- Pricing: **150 USDT/month or 1,500 USDT/year** (2 months free), paid **on-chain via
  smart contract** — no fiat, no card, no Stripe. Both plans are live. The owner surface is
  **fee amounts + treasury destination** (`updateSubscriptionFees` + `updateTreasuryWallet` +
  `transferOwnership`) — owner-adjustable on-chain, no redeploy, no proxy; `treasuryWallet`
  receives only our own fee, so custody is never affected. `usdt` stays immutable.
- Mainnet USDT-TRC20 requires resetting a non-zero allowance to 0 before re-approving; this is
  **implemented** in `ensureAllowance` (`src/lib/tron/allowance.ts`), wired into both the
  disperse and subscribe approve paths, and announces the extra prompt calmly (Law of UX #2).
- Energy constants (`ENERGY_*` / `feeLimitForBatch`) are **Nile-measured** and re-calibrated
  **empirically on mainnet** (one small real batch → read Tronscan → tune); `feeLimit` is a
  ceiling, not a charge. The old `measure.cjs` is broken/retired. See docs/06 §6.
- Free tier: **1 payee per payer wallet, once every 30 days, forever** — a mainnet smoke test,
  enforced **off-chain** in the authorize route (never in `disperse`). Everything beyond it
  needs a subscription (or referral credit). There is **no testnet sandbox** — discarded, see
  docs/07 §1.
- Wallet-control proof: the payout gate authorizes **only after the caller proves it controls
  the payer wallet** — a **single-use signature challenge** (`GET /api/payout/challenge` →
  `signMessageV2`, recovered server-side) checked **before** OFAC / subscription / quota /
  credit. It stores only a salted nonce hash (no PII, 5-min TTL). This is **wallet-control
  proof, not an auth session** — magic-link account auth stays unwired. See docs/07 §4a.
- Referrals: **asymmetric, off-chain credit.** A paying customer's referral link banks them
  **one free month** when someone they invited **pays their first month on-chain**; the invitee
  gets **no discount** (full price). The reward is fixed at **one month per qualified referral**
  because reward (150 USDT of value) must never exceed the referee's cost (150 USDT on-chain) —
  that **1:1 ratio** is the whole anti-fraud (self-referral is zero-margin). Credit is off-chain
  (Supabase), **additive**, lazily consumed at pay time (no indexer); it can only **grant** access,
  never deny it, and a credit-activated month never earns another reward. Behind
  `REFERRALS_ENABLED` (default off). The **contract is untouched** — the chain stays the source of
  truth for payments. See `docs/08-referrals-and-credit.md`.
- Storage: the **roster stays device-local** (IndexedDB); **account-holder PII is
  stored server-side encrypted** (pgcrypto AES-256 — dissociation); recipient addresses
  are salted-hashed for OFAC. Purser stores nothing it can read.
- The contract is **ours** (not a third party's). Its **`disperse` path is permissionless
  and immutable** and it never takes custody. The owner-privileged surface is the
  **subscription fees + the treasury destination** (`updateSubscriptionFees` +
  `updateTreasuryWallet` + `transferOwnership`) — monetization-only, and it can never reach
  funds, keys, broadcast, pause, or disperse. `treasuryWallet` receives only our own fee (never
  user funds) and is owner-updatable so revenue can move to cold/multisig without a redeploy;
  `usdt` stays immutable.
- The batch is **atomic**: all recipients paid in one tx, or none. No partial payout.
  Check balance ≥ sum-of-selected BEFORE enabling "Pay all"; if short, lock the button
  and say how much is missing — never silently drop payees.

---

## NOT IN V1 (YAGNI — do not build)

Multichain · Ledger/WebUSB signing · social login or username+password (magic-link is the
chosen method — and it isn't wired yet) · partial "pay until balance runs out" (atomic
disperse makes it moot) · multi-wallet source · roles / multi-user within an agency ·
cross-device **roster** sync (the roster is per-device by design — a privacy feature, not a
bug; encrypted account PII plus the free-tier/referral rows live server-side, but the roster
never does — and subscription state is on-chain, not server-side) · analytics dashboards ·
any server-side storage of the **roster** (encrypted account PII lives server-side; the roster
does not) · **a customer-facing testnet sandbox / demo / trial environment** (discarded, not
deferred — the mainnet free tier does its job better; see docs/07 §1 and the "Discarded" list in
docs/README.md). NOTE: this discarded item is a *customer product feature* — it is **not** the
same as the **internal two-deployment model** (a `mainnet` prod deployment + a `nile` sandbox
deployment, separate Vercel envs + separate Supabase projects, chosen by
`NEXT_PUBLIC_TRON_NETWORK`) added for mainnet readiness. That internal engineering environment
exists and stays; the closed customer-sandbox decision is not reopened. · **a runtime network
toggle** (rejected — desyncs client from server and cross-writes the production Supabase; see
docs/06 §4).

The **free tier** (1 payee / 30 days) and **off-chain referral credit** ARE shipped — they are
*not* on this list; see STANDING FACTS. If you think you need one of the above, you don't —
flag it to the owner first.

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
- **Consult [`docs/`](./docs) before any structural/architectural change**, and update the
  affected doc in the SAME change (see "Architectural Source of Truth" above). The code is
  authoritative — cross-check a doc claim against the referenced file before acting on it.
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
- `src/components/landing/PricingSection.tsx` — now **150 / 1,500 USDT, on-chain** (no
  fiat, no card), replacing €249 / €2,490.

**Still pending (non-landing).** The port is verified 1:1, so this copy pass is now
**unblocked** — but it is deliberately deferred to its own dedicated pass (this doc-audit
sprint flags, it does not rewrite app copy). Re-audited state of the four originally-listed files:

- `src/components/dashboard/EmptyRoster.tsx` — **genuine item.** The user-facing line "Nothing
  leaves your browser." is stale-absolute: the roster stays, but the signed tx, the encrypted
  PII, and the OFAC screen all leave. Reconcile in the copy pass.
- `src/lib/tron/validation.ts` — **comment-level.** A code comment still cites the old "data
  never leaves the device" framing (CLAUDE.md now scopes that to the *roster*); the ✓✓ privacy
  invariant it documents is accurate.
- `src/lib/db.ts`, `src/lib/receipts.ts` — **no longer pending.** Re-audited: their device-local
  comments are roster-scoped and accurate (the roster genuinely is IndexedDB-only, never a
  server call), so there is nothing stale to reconcile.
