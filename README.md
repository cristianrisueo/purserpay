# PurserPay

**Non-custodial, no-KYC USDT payouts for de-banked businesses.**
Load your team, sign once, and pay everyone straight from your own wallet — Purser never
touches your money, your keys, or your list.

> This README is the high-level map for **humans and AI agents**. For deep technical
> detail, the architectural source of truth is [`docs/`](./docs). Product/governance rules
> live in [`CLAUDE.md`](./CLAUDE.md).

---

## The problem

Banks, PayPal, Wise, and Deel shut down businesses that operate in gray-area or
adult-adjacent industries. So these businesses pay their distributed teams — remote staff,
contractors, freelancers — by hand: messy spreadsheets, manual commission math, copy-
pasting wallet addresses one at a time, terrified of a typo on real money.

## What the machine does

PurserPay reads their team, validates every address, computes the splits, and compiles an
**unsigned batch transaction** the business signs with its **own** wallet. USDT (TRC20 on
TRON) moves straight from their wallet to their team, in **one** signature.

**Purser never holds funds, keys, or broadcast.** The app only *builds* the transaction;
the user's own wallet signs and sends it. That's the legal moat (arm's-length, no
money-transmitter license) and the sales pitch, in one.

---

## Three core features

### 1. Sencillez — Simplicity

An agency owner opens this tired at 11pm and pays a $50k batch **without being afraid of
screwing up**. Governed by the **3 Laws of UX** (see `CLAUDE.md`): ≤ 3 clicks for any
action, zero fear, beauty = trust.

- The heart is a living **TanStack Table** — everyone checked by default, uncheck to skip
  (never deletes), green = paid, the pay button locks if the balance won't cover.
- One import (CSV) → validate → sign. Receipts and reports are one click, local, private.
- Code: `src/views/Dashboard.tsx`, `src/hooks/usePayout.ts`, `src/components/dashboard/*`.

### 2. Seguridad — Security

- **Non-custodial by construction.** Every signature goes through the user's own injected
  wallet; there is no server-side signer. The contract holds nothing (balance ≡ 0), has no
  withdraw/upgrade/pause, and its `disperse` path is permissionless and immutable. The owner's
  only powers are repricing the flat fee and redirecting **our own** subscription-fee treasury
  (`updateTreasuryWallet`, for moving revenue to cold/multisig without a redeploy) — never user
  funds, keys, broadcast, or `disperse`.
- **Atomic batches, no false green.** A batch confirms whole or reverts whole; a row turns
  green only on a `SUCCESS` on-chain receipt.
- **OFAC screening + fail-closed gates.** Recipients are screened server-side before any
  signature; if screening can't run, the batch is **blocked**, never waved through.
- Code: `contracts/src/PurserPay.sol`, `src/lib/tron/{client,disperse,subscription}.ts`,
  `src/app/actions/compliance.ts`. Deep-dive: [`docs/02`](./docs/02-non-custodial.md),
  [`docs/05`](./docs/05-smart-contract.md).

### 3. Privacidad — Privacy

- **Data dissociation — we store nothing we can read.** The **roster** (names, addresses,
  amounts) stays **device-local** (IndexedDB) and never reaches a server. The account
  holder's **own PII** is stored **encrypted** (pgcrypto AES-256); wallet addresses touched
  for screening are **salted-SHA-256 hashed**. Identity is separated from payout activity
  by schema design.
- **The private double-check.** The ✓✓ "paid-before" read sends only the operator's *own*
  wallet to the node and matches payee addresses **locally** — payee addresses are never
  transmitted.
- Code: `src/lib/db.ts`, `src/lib/crypto.ts`, `src/lib/tron/validation.ts`,
  `supabase/migrations/0001_compliance_schema.sql`. Deep-dive:
  [`docs/03`](./docs/03-data-flow.md), [`docs/04`](./docs/04-compliance-and-encryption.md).

---

## Architecture snapshot

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript (strict), on Vercel |
| UI | shadcn/ui + Tailwind v4 + Radix; TanStack Table |
| Roster storage | Dexie / IndexedDB (device-local) |
| Account + compliance | Supabase (Postgres + pgcrypto) |
| Web3 | tronweb 6 + TronLink (WalletConnect stubbed) |
| Contract | own `PurserPay.sol` (Foundry) — `disperse` + `subscribe` |
| Chain | **TRON only**, **USDT (TRC20) only** — network chosen at build time by `NEXT_PUBLIC_TRON_NETWORK` (`mainnet \| nile`); Nile deployed today, mainnet pending |
| Billing | on-chain subscription: **150 USDT/mo** or **1,500 USDT/yr** (no fiat, no Stripe) |
| Free tier | **1 payee / payer wallet / 30 days**, forever — a mainnet smoke test. Off-chain licence gate ([`docs/07`](./docs/07-freemium-gate.md)); everything else needs the subscription. |
| Referrals | asymmetric: a paying customer's first-paid referral banks them **one free month** (off-chain credit); the invitee pays full price. Reward == referee cost (**1:1**, self-referral is zero-margin). Behind `REFERRALS_ENABLED` ([`docs/08`](./docs/08-referrals-and-credit.md)). |

- Landing `/` is server-rendered; the dashboard `/dashboard` is client-only (`ssr:false`)
  because it reads IndexedDB and the injected wallet at mount.
- Every payout funnels through one 3-gate choke-point: **entitlement (subscription or
  referral credit) → OFAC → disperse** (`src/hooks/usePayout.ts`). See
  [`docs/03`](./docs/03-data-flow.md).

```
src/
  app/            # routes + "use server" compliance actions
  views/          # Landing (SSR) · Dashboard (client-only)
  hooks/          # usePayout — the state machine
  components/     # landing/ · dashboard/ · ui/ (shadcn, owned)
  lib/            # db (Dexie) · crypto · receipts · supabase/ · tron/
contracts/        # Foundry: PurserPay.sol + tests
scripts/tron/     # deploy / verify / measure
supabase/         # 0001 compliance · 0002 free tier · 0003 referrals
docs/             # ← architectural source of truth (start here)
```

## Quickstart

```bash
npm install
cp .env.local.example .env.local      # fill in values — see docs/04 §5
npm run dev                           # http://localhost:3000

npm run typecheck                     # tsc --noEmit
npm run build                         # production build
npm run lint

cd contracts && forge build && forge test -vv   # 30 tests (29 unit + 1 invariant)
```

Environment variables are documented in `.env.local.example` and
[`docs/04`](./docs/04-compliance-and-encryption.md). One is **required at build time**:
`NEXT_PUBLIC_TRON_NETWORK` (`mainnet | nile`) — `config.ts` throws if it's missing. Deploying
the contract / switching networks is in [`docs/06`](./docs/06-deployment.md).

## Documentation map

- [`docs/`](./docs) — **architectural source of truth** (architecture, data-flow,
  compliance, contract, deployment, free tier, referrals). Start at
  [`docs/README.md`](./docs/README.md).
- [`CLAUDE.md`](./CLAUDE.md) — product philosophy, governance rules, standing facts, the 3
  Laws of UX, and "not in V1".
- [`SPRINTS.md`](./SPRINTS.md) — the Vite-era build log (Spanish, historical).

> **For AI agents:** before proposing any structural or architectural change, read
> [`docs/`](./docs) and honor the invariants cheat-sheet there. The code is authoritative
> — cross-check any doc claim against the referenced files before acting.

## The one rule that never bends

**Non-custodial, always. No exceptions, ever.** Purser never holds funds, never holds keys,
never broadcasts. If a task seems to require otherwise — holding funds/keys, broadcasting
for the user, storing the roster server-side, or storing readable PII — **stop and flag
it.** See [`docs/02`](./docs/02-non-custodial.md).
