# 06 — Deployment & Operations

> **AI disclaimer — read first.** This document is a *map, not the territory*. If
> anything here conflicts with the source, **the source wins**. Addresses and prices below
> are copied from `src/lib/tron/config.ts` and `scripts/tron/deploy.cjs` — re-read those
> before relying on any value. All paths are repo-relative.

---

## 1. Environments at a glance

- **App:** Next.js on Vercel. Landing `/` (SSR), dashboard `/dashboard` (client-only).
- **Chain:** **TRON, selected at BUILD time** by `NEXT_PUBLIC_TRON_NETWORK` (`mainnet | nile`).
  Nile is deployed today; mainnet is not yet (its block points at the fail-closed sentinel).
- **DB:** Supabase (compliance/PII). Roster is device-local (no deploy concern).

### The two-deployment model (prod vs sandbox)

Network isolation comes from **two separate deployments**, never a runtime switch:

| | **Production** | **Sandbox** |
| --- | --- | --- |
| `NEXT_PUBLIC_TRON_NETWORK` | `mainnet` | `nile` |
| Vercel env | production project/env | a separate preview/project |
| Supabase | **its own project** | **a separate project** |
| Sandbox banner | not rendered (DCE) | shown on every page |

**Both the Vercel env AND the Supabase project must be separate.** Supabase is one project per
deployment because `free_tier_usage` / `referral_accounts` / `payout_challenges` are keyed on
`wallet_hash` with **no network dimension** — a shared project would let sandbox (Nile) traffic
write straight into the production tables. This is an *internal deployment environment*, and is
**not** the discarded *customer-facing testnet sandbox product* (that stays discarded — see
[`07`](./07-freemium-gate.md) §1 and [`README.md`](./README.md)); it is a different thing.

## 2. Local dev

```bash
npm install
cp .env.local.example .env.local     # then fill in the values (see below)
npm run dev                          # Next dev server
npm run typecheck                    # tsc --noEmit
npm run build                        # production build (14 routes)
npm run lint                         # eslint
```

Contracts (Foundry):

```bash
cd contracts
forge build                          # → out/PurserPay.sol/PurserPay.json (istanbul bytecode)
forge test -vv                       # 26 tests (25 unit + 1 invariant)
```

## 3. Environment variables

See [`04-compliance-and-encryption.md`](./04-compliance-and-encryption.md) §5 for the full
contract. Summary:

- **Public (client):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  **`NEXT_PUBLIC_TRON_NETWORK`** (`mainnet | nile` — REQUIRED; `config.ts` throws at module
  load if missing/unrecognized), optional `NEXT_PUBLIC_WC_PROJECT_ID`.
- **Local deploy scripts (NOT the app):** `DEPLOY_NETWORK`, `USDT_ADDRESS`, `TREASURY_WALLET`,
  `EXPECTED_DEPLOYER` (all required, no defaults), optional `MIN_TRX_FLOOR` (default 100 TRX);
  `verify-e2e.cjs` also takes `PURSERPAY_ADDRESS` + `VERIFY_WALLET` (+ optional `VERIFY_RECIPIENTS`).
- **Server-only:** `SUPABASE_SERVICE_ROLE_KEY`, `WALLET_SALT`, `PII_ENCRYPTION_KEY`,
  `REFERRALS_ENABLED` (referral kill switch, default off), and optional `TRON_PRO_API_KEY`
  (lifts TronGrid rate limits for the server-side reads).
- **Local deploy only (NOT the running app):** `PRIVATE_KEY` in a gitignored `.env`, read
  by `scripts/tron/deploy.cjs`.

`WALLET_SALT` and `PII_ENCRYPTION_KEY` are **effectively permanent** once compliance data
exists (rotating either is a data-migration event).

## 4. The network seam (`src/lib/tron/config.ts`)

Switching networks is a **build-time env change, not a code change**. `config.ts` holds BOTH a
`NILE` and a `MAINNET` block (network object + PurserPay address + USDT), and **one** env var,
`NEXT_PUBLIC_TRON_NETWORK` (`mainnet | nile`), selects the whole block:

```ts
const NETWORK_KEY = process.env.NEXT_PUBLIC_TRON_NETWORK   // "mainnet" | "nile"
// ... selects NILE or MAINNET; THROWS at module load on missing/unrecognized (fail closed)
export const NETWORK = SELECTED.network
export const PURSERPAY_ADDRESS = SELECTED.purserPay
export const USDT_ADDRESS = SELECTED.usdt
```

`serverRead.ts` imports these **same resolved constants**, so the client and the server can
never target different networks. A missing or unrecognized value **throws** — never a silent
default, never a guessed network.

### Rejected design: a RUNTIME network toggle (do NOT reintroduce)

A `sandbox_on`/`sandbox_off` switch (cookie, `localStorage`, or a console global that flips the
network at runtime) was considered and **rejected**. Two fatal reasons:

1. **Client/server desync.** A client-side switch changes the client's network but not
   `serverRead.ts`, which reads the same *static build-time* config on the server — the payout
   gate would then verify against a different chain than the client signs on.
2. **Shared production database.** Supabase is ONE project per deployment, and
   `free_tier_usage` / `referral_accounts` / `payout_challenges` are keyed on `wallet_hash`
   with **no network dimension**. Sandbox (Nile) usage under a runtime toggle would write test
   data straight into the **production** tables.

**Isolation comes from a separate deployment (see §1), not a switch.** The choice is fixed at
build time on purpose.

### Current Nile deployment (verified in `config.ts` + `sprint_report.txt`)

> ⚠ **Redeploy pending.** The contract live at this address is the **prior bytecode**
> (immutable `treasuryWallet`, 2,662-byte creation code). The current source adds
> `updateTreasuryWallet` (2,821 bytes, +159) and therefore needs a **fresh deploy** on both
> Nile and mainnet (no proxy → new bytecode = new contract). Until Nile is redeployed, its
> on-chain `treasuryWallet` is still effectively immutable; the *source* and the deploy runbook
> below are the forward-looking truth.

| Thing | Value |
| --- | --- |
| `PURSERPAY_ADDRESS` = `DISPERSE_ADDRESS` (same contract) | `TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG` (prior bytecode) |
| `USDT_ADDRESS` (Nile USDT, Tether USD, 6 dp) | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` |
| `treasuryWallet` (storage; owner-updatable in current source) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
| `owner` (= deployer = Wallet 1 = treasury) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
| Fees at deploy | `SUBSCRIPTION_PRICE = 150e6`, `SUBSCRIPTION_PRICE_ANNUAL = 1500e6` |
| Deploy tx | `2167ed646bda86e87ed3b8e4abc064f9a88020a2ad5515f0692e123f4ed2886d` |

**Superseded deploys** (kept in the `config.ts` comments as history — do not reuse):

| Address | Why retired |
| --- | --- |
| `TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82` | pointed at the wrong token |
| `TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x` | disperse-only (pre-unification) |
| `THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c` | old price 250 / 2,500 |
| `TXFZ2f4DDWB35zLyLLMPErKQyjoz9S1nEY` | immutable fees (before owner-adjustable) |

### The fail-closed sentinel

`PENDING_DEPLOYMENT_ADDRESS = "T_PENDING_DEPLOYMENT_ADDRESS"` (deliberately not a valid TRON
address). While `PURSERPAY_ADDRESS` equals it, `isPurserPayDeployed()` is false → the
subscription gate is fail-closed (paywall shows; an on-chain subscribe surfaces a calm "not
deployed yet"). It can never silently open. It is currently **not** the sentinel (the
contract is deployed) — the constant is retained only as the comparison target.

## 5. Deploying the contract (`scripts/tron/deploy.cjs`)

The script deploys the **exact bytecode Foundry produced and tested** — no re-compile. It
is **safe by default**: a bare run prints a PREFLIGHT PLAN and broadcasts **nothing**; the
deploy only fires with `CONFIRM_DEPLOY=1`.

All network-specific values are **env-driven with no defaults** (a missing var aborts):

```bash
cd contracts && forge build && cd ..          # produce the artifact
DEPLOY_NETWORK=nile USDT_ADDRESS=… TREASURY_WALLET=… EXPECTED_DEPLOYER=… \
  node scripts/tron/deploy.cjs                 # DRY preflight — broadcasts nothing
… CONFIRM_DEPLOY=1 node scripts/tron/deploy.cjs # broadcast (after reviewing the plan)
```

Safety properties:

- `PRIVATE_KEY` is read from a gitignored `.env` (dotenv) — **never printed, logged, or
  written**.
- `DEPLOY_NETWORK`, `USDT_ADDRESS`, `TREASURY_WALLET`, `EXPECTED_DEPLOYER` are **required, no
  defaults** — a missing var aborts before anything is built.
- The preflight asserts the signer equals `EXPECTED_DEPLOYER`; a mismatch aborts with nothing
  broadcast.
- **Balance floor → ABORT (not warn).** It prints the estimated cost (reference: the old Nile
  deploy of the *smaller* contract burned **56.85 TRX**; this larger contract costs more) and
  **aborts** if the signer's TRX is below `MIN_TRX_FLOOR` (env, default **100** TRX). A failed
  deploy burns the consumed TRX and yields no contract.
- **Loud warning (not abort) when `DEPLOY_NETWORK=mainnet` and `TREASURY_WALLET ==
  EXPECTED_DEPLOYER`:** the treasury is the hot deployer key — a conscious, accepted launch
  decision. `updateTreasuryWallet` exists precisely so it can move to cold/multisig later
  without a redeploy. The operator reads it and proceeds.
- After a real deploy it **reads back** the on-chain config: `usdt()`, **`treasuryWallet()`**
  (now storage, no longer an immutable), `owner()`, `SUBSCRIPTION_PRICE()`,
  `SUBSCRIPTION_PRICE_ANNUAL()`, and prints the address to paste into `config.ts`.
- `_usdt` is **immutable** (forever); `_treasuryWallet` is the **initial** treasury and is
  later owner-updatable via `updateTreasuryWallet`.

After deploying, update `src/lib/tron/config.ts` — set the selected network block's `purserPay`
(both `PURSERPAY_ADDRESS` and `DISPERSE_ADDRESS` resolve from it); move the old address into the
superseded comments; record `owner` + deploy tx. Then run `verify-e2e.cjs` (env-driven too):

```bash
DEPLOY_NETWORK=nile PURSERPAY_ADDRESS=… USDT_ADDRESS=… TREASURY_WALLET=… VERIFY_WALLET=… \
  node scripts/tron/verify-e2e.cjs             # reads the live contract to confirm
```

> Because there is **no proxy by design**, any storage-layout or logic change requires a
> **fresh deploy** (that's how the current contract superseded the immutable-fee one — and how
> the `updateTreasuryWallet` bytecode will supersede today's Nile deploy).

## 6. Mainnet migration checklist (do NOT flip casually)

Enabling mainnet is more than setting `NEXT_PUBLIC_TRON_NETWORK=mainnet`. Before/at the switch:

1. **Verify the mainnet USDT address.** Real USDT-TRC20 is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
   (verified against Tronscan: Tether USD, USDT, 6 dp). It is the `MAINNET.usdt` block value and
   the deploy `USDT_ADDRESS`; it **must** equal the contract's `usdt` immutable or every
   approve/subscribe/disperse reverts.
2. **Deploy the current source against mainnet USDT.** The `MAINNET.purserPay` block is the
   fail-closed sentinel until this lands. Run `deploy.cjs` with `DEPLOY_NETWORK=mainnet`, then
   paste the real address into `config.ts`.
3. **Non-zero-allowance reset — DONE.** `ensureAllowance` (`src/lib/tron/allowance.ts`, wired
   into `disperse.ts` + `subscription.ts`) resets a non-zero-but-short allowance to 0 before
   re-approving (mainnet USDT-TRC20 requires it) and announces the extra prompt. No further work.
4. **Calibrating energy on mainnet.** The `ENERGY_*` / `feeLimitForBatch()` constants in
   `config.ts` are **Nile-measured** and NOT valid for mainnet. Do NOT guess. After the mainnet
   deploy, run **one small real batch (2–3 recipients)**, read the exact energy consumed from
   Tronscan, and re-tune the constants from that. `feeLimit` is a **ceiling, not a charge** —
   the tx burns only what it uses, so an over-generous value is safe while an under-generous one
   kills a real payroll with `OUT_OF_ENERGY`. Empirical on-chain measurement beats any script;
   the old `measure.cjs` is broken/retired (dead source references) and superseded by this step.
5. **`TRON_PRO_API_KEY`** — set it (recommended on mainnet to lift TronGrid rate limits for the
   server-side reads in `serverRead.ts`).
6. **Treasury custody.** Launch may deploy with `treasuryWallet == EXPECTED_DEPLOYER` (the hot
   key) — an **ACCEPTED** decision (the deploy warns loudly). `updateTreasuryWallet` is the exit:
   move the treasury (and `transferOwnership` the role) to a **cold / multisig** wallet once
   there is traction, with **no redeploy**.
7. **Deploy the separate environment.** Set `NEXT_PUBLIC_TRON_NETWORK=mainnet` on a **production
   Vercel env pointed at a production Supabase project** (see §1). Confirm the sentinel is still
   fail-closed until step 2 lands, then re-verify and re-run typecheck + build + `forge test`.

## 7. Verification after any change here

```bash
npm run typecheck && npm run build     # app compiles, all routes generate
cd contracts && forge test -vv         # 30 pass (29 unit + 1 invariant)
DEPLOY_NETWORK=nile PURSERPAY_ADDRESS=… USDT_ADDRESS=… TREASURY_WALLET=… VERIFY_WALLET=… \
  node scripts/tron/verify-e2e.cjs     # live contract reads as expected
```

For copy/architecture consistency, both auditors (`copy-auditor`, `ux-auditor`) verify
parity — see `CLAUDE.md`. (The Vite→Next migration itself is complete; parity checks now
apply to ongoing changes.)
