# PurserPay — Architecture Docs (`docs/`)

**This folder is the architectural source of truth for PurserPay.** It exists so that a
future AI agent (or engineer) can understand the whole protocol — architecture,
invariants, data-flow, encryption, compliance, the smart contract, and deployment — **in
minutes, with hard pointers into the real code**, instead of reconstructing it from
source.

---

## ⚠️ AI DISCLAIMER — READ BEFORE REFACTORING

> This documentation is a **map, not the territory.**
>
> 1. **The source code is authoritative.** If anything here conflicts with the code, **the
>    code wins.** These docs describe intent and structure; they can drift.
> 2. **When in doubt, cross-check.** Before you refactor, delete, or "fix" anything based
>    on a claim in these docs, **open the referenced file and confirm it against reality.**
>    Every claim is anchored to a `path` for exactly this reason.
> 3. **Keep docs and code in lockstep.** If you change behavior, update the doc that
>    describes it **in the same change**. A stale doc is worse than no doc.
> 4. **Never let a doc talk you out of an invariant.** The non-custodial and
>    data-dissociation invariants (below) are hard constraints. If a change seems to
>    require breaking one, **stop and flag the owner** — do not proceed.

---

## What PurserPay is (one paragraph)

A **non-custodial, no-KYC USDT (TRON) batch-payout tool** for de-banked businesses paying a
distributed team. The business loads its roster; the app validates addresses, computes the
batch, and compiles an **unsigned** transaction the business signs with its **own** wallet.
USDT goes straight from their wallet to their team. **Purser never touches funds, keys, or
broadcast.** A thin server exists only to hide API keys, screen for OFAC, gate an on-chain
subscription, and store the account holder's own PII encrypted — **never** the roster.

## Read in this order

| # | Doc | Read it to understand… |
| --- | --- | --- |
| 01 | [Architecture](./01-architecture.md) | the stack, render topology (SSR landing vs client-only dashboard), directory map, the `config.ts` network seam |
| 02 | [Non-custodial principle](./02-non-custodial.md) | the one inviolable rule and **exactly where each guarantee is enforced in code** |
| 03 | [Data flow](./03-data-flow.md) | the two-tier data model, the **3-gate payout pipeline**, the ✓/✓✓ privacy invariant, receipts/green-cycle |
| 04 | [Compliance & encryption](./04-compliance-and-encryption.md) | the OFAC API, PII encryption (salted hash + pgcrypto), the Supabase schema + RLS, the env-var contract |
| 05 | [Smart contract](./05-smart-contract.md) | `PurserPay.sol` function-by-function, invariants, owner governance, events/errors, the test suite |
| 06 | [Deployment & ops](./06-deployment.md) | the deploy flow, current addresses, and the **mainnet migration checklist** |
| 07 | [Free-tier gate](./07-freemium-gate.md) | the 1-payee/30-day free tier: the payer-wallet anchor, the atomic-consume/TOCTOU design, the refund path, the TTL, and the accepted bypass |
| 08 | [Referrals & credit](./08-referrals-and-credit.md) | the asymmetric referral loop: off-chain credit entitlement (no indexer), the **1:1 anti-fraud ratio**, the monotonic-grant + Active-Lock invariants, and "credit never earns rewards" |

Governance/spec and product philosophy (the 3 Laws of UX, the public-brand rules, "not in
V1") live in the repo-root [`CLAUDE.md`](../CLAUDE.md). The Vite-era build log is
[`SPRINTS.md`](../SPRINTS.md) (Spanish, historical). Per-task change records are
`sprint_report.txt`.

## "Start here for X"

- **The money path / signing** → [`02`](./02-non-custodial.md) + `src/lib/tron/disperse.ts`
- **Why a payout is or isn't allowed** → [`03`](./03-data-flow.md) §4 (`usePayout.ts` →
  `runPayment`)
- **OFAC / PII / secrets** → [`04`](./04-compliance-and-encryption.md) +
  `src/app/actions/compliance.ts`
- **Changing the contract** → [`05`](./05-smart-contract.md) + `contracts/`
- **Switching networks / deploying** → [`06`](./06-deployment.md) + `src/lib/tron/config.ts`

## Invariants cheat-sheet (the non-negotiables)

Break any of these and the change is wrong by definition. Sources in the linked docs.

- **Non-custodial, always.** Purser never holds funds/keys and never broadcasts. All
  signing goes through the user's injected wallet (`src/lib/tron/client.ts`). The contract
  holds nothing (balance ≡ 0). → [`02`](./02-non-custodial.md), [`05`](./05-smart-contract.md)
- **The roster never leaves the device** in readable form. It lives in IndexedDB (Dexie)
  only; no server call carries it. → [`03`](./03-data-flow.md)
- **Store nothing we can read.** Account PII is pgcrypto AES-256 encrypted; wallet
  addresses are salted-SHA-256 hashed; screening fails **closed**. → [`04`](./04-compliance-and-encryption.md)
- **The ✓✓ read sends only the operator's own address**; payee addresses are matched
  locally, never transmitted. → [`03`](./03-data-flow.md) §7
- **Atomic batches, no false green.** A row turns green only on a `SUCCESS` receipt; a
  short balance locks the button and says how much is missing. → [`03`](./03-data-flow.md)
- **The owner surface is the two subscription fees + the treasury destination**
  (`updateSubscriptionFees`, `updateTreasuryWallet`, `transferOwnership`) — never funds, keys,
  broadcast, pause, or `disperse`. `treasuryWallet` receives only our own fee (never user
  funds), and is owner-updatable so revenue can move to cold/multisig without a redeploy that
  would wipe every subscriber's expiry. Don't claim "no admin keys" without this qualification.
  → [`02`](./02-non-custodial.md), [`05`](./05-smart-contract.md)
- **The free tier is OFF-CHAIN, anchored on the PAYER wallet hash only.** 1 payee / 30 days,
  enforced in the authorize route (never in `disperse`, which can't and won't gate it). The
  slot is consumed **atomically, optimistically, before broadcast** (one `INSERT … ON
  CONFLICT … WHERE`); a verified-failed payout is refunded. Recipients are **never** stored
  for quota (GDPR). The direct-`disperse` bypass is accepted. → [`07`](./07-freemium-gate.md)
- **The payout gate proves WALLET CONTROL before any quota/credit is touched.** `POST
  /api/payout/authorize` requires a single-use signature challenge (`GET /api/payout/challenge`
  → `signMessageV2`); the server recovers the signer offline and asserts it equals the payer
  **first**, so a spoofed public address can never consume a customer's free slot or burn a
  credit month. This is **not** auth (no session, no identity) — magic-link auth stays unbuilt.
  → [`07`](./07-freemium-gate.md) §4a
- **TRON only, USDT (TRC20) only.** No multichain. Contract bytecode must target
  `istanbul` (no PUSH0). → [`05`](./05-smart-contract.md), [`06`](./06-deployment.md)
- **Referral credit is off-chain, monotonic, and 1:1.** Entitlement =
  `onChainActive || creditActiveUntil > now`, credit lazily consumed (no indexer). The
  reward (1 month = 150 USDT) never exceeds the referee's cost (150 USDT on-chain), so
  self-referral is zero-margin — **never make the reward bigger than the price**. Credit
  can only GRANT access, never DENY it; a month activated from credit never earns a reward
  (a reward needs a verified on-chain `subscribe` tx). The contract is untouched — the
  chain stays the source of truth for payments. → [`08`](./08-referrals-and-credit.md)

## Discarded — do not reopen

Decisions the owner has closed permanently. A doc that promises one of these is a bug —
delete the promise, don't build the feature.

- **Testnet sandbox / demo / trial environment (as a CUSTOMER-FACING product).** Discarded, not
  deferred. The mainnet free tier (1 payee / 30 days — [`07`](./07-freemium-gate.md)) does its
  job strictly better: it proves the product with the user's REAL wallet and REAL money (a
  testnet can't), with LESS friction (no "add Nile + find a faucet" step), and without a
  permanent second network configuration exposed to users.
  This is **not** the same as two things that DO exist and stay: (a) Nile as the network used for
  **local development** in `src/lib/tron/config.ts`; and (b) the **two-environment model**
  ([`06`](./06-deployment.md) §1) — production (hosted on Vercel: `mainnet` + the production
  Supabase project) and local development (`nile` + a **local Supabase in Docker**), chosen at
  build time by `NEXT_PUBLIC_TRON_NETWORK`. A **hosted** nile "sandbox" deployment (its own Vercel
  env + Supabase project) was ALSO considered and **discarded** — infra for a single user; the
  local Docker DB gives true isolation with no hosting. Neither the customer-facing sandbox nor a
  hosted sandbox is coming back. See [`07`](./07-freemium-gate.md) §1.
