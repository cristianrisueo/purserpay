# 06 — Deployment & Operations

> **AI disclaimer — read first.** This document is a *map, not the territory*. If
> anything here conflicts with the source, **the source wins**. Addresses and prices below
> are copied from `src/lib/tron/config.ts` and `scripts/tron/deploy.cjs` — re-read those
> before relying on any value. All paths are repo-relative.

---

## 1. Environments at a glance

- **App:** Next.js on Vercel. Landing `/` (SSR), dashboard `/dashboard` (client-only).
- **Chain:** **TRON, selected at BUILD time** by `NEXT_PUBLIC_TRON_NETWORK` (`mainnet | nile`).
  **Both networks now carry the deployed contract** (mainnet `TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha`,
  nile `TK9z7J4TZBB5UjaFmE8kvNDehdAJFecUnX`). The mainnet contract is live on-chain and wired in
  `config.ts`, but the **production Vercel env flip** (`NEXT_PUBLIC_TRON_NETWORK=mainnet`) is still
  pending — so customers are not on mainnet yet.
- **DB:** Supabase (compliance/PII). Roster is device-local (no deploy concern).

### The two-environment model (production vs local development)

There is exactly **one hosted environment** (production) and one **local** environment. The
network seam (`NEXT_PUBLIC_TRON_NETWORK`) is the only lever; there is no runtime toggle.

| | **Production** (hosted) | **Local development** (your machine) |
| --- | --- | --- |
| `NEXT_PUBLIC_TRON_NETWORK` | `mainnet` | `nile` |
| Where | Vercel | `npm run dev` on localhost |
| Supabase | the production project (cloud) | **local Supabase (Docker)**, `npm run db:start` |
| Sandbox banner | not rendered (DCE) | shown on every page |

**Local dev runs against a local Supabase, NOT the production project and NOT a second cloud
project.** The isolation is **physical, not disciplinary**: with a local instance, touching
production is *impossible*, not merely "don't mistype the URL". This matters because the
compliance tables (`free_tier_usage` / `referral_accounts` / `payout_challenges` /
`billing_profiles`) key on `wallet_hash` with **no network/environment dimension** — so a testnet
payout on localhost, pointed at production, would write into the very rows a mainnet customer
will use (and see [`04`](./04-compliance-and-encryption.md) §5: a shared `WALLET_SALT` would make
the hashes collide even across separate databases — dev uses a **fresh, distinct** salt).

> **There is NO public/hosted "sandbox" deployment.** A hosted Nile deployment (its own Vercel
> env + its own Supabase project) was considered and **discarded** — it is infrastructure for a
> single user; the local Docker environment does the same job with zero hosting and true
> isolation. This is distinct from, and in addition to, the long-discarded *customer-facing
> testnet-sandbox product* (see [`07`](./07-freemium-gate.md) §1). The only sandbox is local dev.

## 2. Local dev

```bash
npm install
cp .env.local.example .env.local     # use the LOCAL DEVELOPMENT block (points at local Supabase)
npm run db:start                     # boot local Supabase (Docker) — applies migrations 0001–0004
npm run dev                          # Next dev server (localhost = nile + local Supabase)
npm run typecheck                    # tsc --noEmit
npm run build                        # production build (14 routes)
npm run lint                         # eslint
```

Local database (Supabase CLI + Docker — a **devDependency**, not a runtime dep):

```bash
npm run db:start                     # start the local stack (prints URL + keys)
npm run db:status                    # show URL + anon/service keys again
npm run db:reset                     # re-apply all migrations to an EMPTY db (from-scratch test)
npm run db:stop                      # stop the local stack
```

Requires Docker running. `db:reset` is also the proof the migrations apply cleanly, in order,
against a virgin database.

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
  `EXPECTED_DEPLOYER` (all required, no defaults), optional `MIN_TRX_FLOOR` (default **80 TRX** —
  above the ~61 TRX real deploy cost, below the owner's ~99.5 TRX mainnet balance; a floor, not a
  budget); `verify-e2e.cjs` also takes `PURSERPAY_ADDRESS` + `VERIFY_WALLET` (+ optional
  `VERIFY_RECIPIENTS`).
- **Server-only:** `SUPABASE_SERVICE_ROLE_KEY`, `WALLET_SALT`, `PII_ENCRYPTION_KEY`,
  `REFERRALS_ENABLED` (referral kill switch, default off), and `TRON_PRO_API_KEY` — **optional on
  Nile, REQUIRED on mainnet** (without it TronGrid throttles the gate's reads → fail-closed for
  paying customers; `serverRead.ts` throws at boot on a mainnet build if it's missing).
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

### Mainnet deployment — PRODUCTION contract (verified in `config.ts` + `sprint_report.txt`)

The **current bytecode** (owner-updatable `treasuryWallet`, 2,821-byte creation code, identical
to the Nile-rehearsed contract) is live on TRON mainnet. Read back on-chain post-deploy — every
value below confirmed via `verify-e2e.cjs`, `usdt()` included (the one immutable that can't be
fixed after the fact).

| Thing | Value |
| --- | --- |
| `PURSERPAY_ADDRESS` = `DISPERSE_ADDRESS` (same contract) | `TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha` |
| `USDT_ADDRESS` (mainnet Tether USD, 6 dp) | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| `treasuryWallet` (storage; owner-updatable) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
| `owner` (= deployer = treasury = HOT key, see §6) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
| Fees at deploy | `SUBSCRIPTION_PRICE = 150e6`, `SUBSCRIPTION_PRICE_ANNUAL = 1500e6` |
| Deploy tx | `4f2bca105f5edbc468e3325fc150b2ef87066a439204b853e3c50bc4cf0a92e5` |
| Deploy cost | **62.71 TRX** / 580,485 energy (58.05 energy fee + net fee, at 100 sun/energy) |

> The deploy broadcast **succeeded** but the script's keyless receipt read-back hit a TronGrid
> **429** (rate limit), so the address wasn't printed. Root cause + fix: `lib.cjs`/`verify-e2e.cjs`
> now attach `TRON_PRO_API_KEY` and **require it on mainnet** (`apiKeyHeaders`) — a keyless mainnet
> deploy/read 429s. Address recovered from the on-chain `CreateSmartContract` tx and verified.

### Nile deployment — SANDBOX environment (verified in `config.ts` + `sprint_report.txt`)

Nile carries the same bytecode (deployed in the dress rehearsal that preceded mainnet).

| Thing | Value |
| --- | --- |
| `PURSERPAY_ADDRESS` = `DISPERSE_ADDRESS` (same contract) | `TK9z7J4TZBB5UjaFmE8kvNDehdAJFecUnX` |
| `USDT_ADDRESS` (Nile USDT, Tether USD, 6 dp) | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` |
| `treasuryWallet` (storage; owner-updatable) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
| `owner` (= deployer = Wallet 1 = treasury) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
| Fees at deploy | `SUBSCRIPTION_PRICE = 150e6`, `SUBSCRIPTION_PRICE_ANNUAL = 1500e6` |
| Deploy tx | `6e3df940ea64fda7699a60812f4d4f0ae334a081801bd4e2b0f23d73a838f307` |
| Deploy cost | 46.97 TRX / 580,485 energy (the mainnet run then cost 62.71 TRX — no staked energy) |

**Superseded deploys** (kept in the `config.ts` comments as history — do not reuse):

| Address | Why retired |
| --- | --- |
| `TCmBbaSkcWVbXy85yQGQVkUaB2tUrDMk82` | pointed at the wrong token |
| `TREGLgfBEt8hfJHr9euGqzYAqLMTNc4A8x` | disperse-only (pre-unification) |
| `THGTj7WRV7ZJMLabUyMgkAduw2NLD3W52c` | old price 250 / 2,500 |
| `TXFZ2f4DDWB35zLyLLMPErKQyjoz9S1nEY` | immutable fees (before owner-adjustable) |
| `TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG` | prior bytecode — immutable `treasuryWallet`, before `updateTreasuryWallet` |

### The fail-closed sentinel

`PENDING_DEPLOYMENT_ADDRESS = "T_PENDING_DEPLOYMENT_ADDRESS"` (deliberately not a valid TRON
address). While `PURSERPAY_ADDRESS` equals it, `isPurserPayDeployed()` is false → the
subscription gate is fail-closed (paywall shows; an on-chain subscribe surfaces a calm "not
deployed yet"). It can never silently open. **Both** networks now carry real addresses, so
neither block points at the sentinel and the gate is **open** on both — the constant is retained
only as the comparison target (and for a hypothetical future network block shipped before its deploy).

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

1. **Verify the mainnet USDT address — DONE.** Real USDT-TRC20 is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
   (verified against Tronscan: Tether USD, USDT, 6 dp, AND read back on-chain as the contract's
   `usdt()`). It is the `MAINNET.usdt` block value and the deploy `USDT_ADDRESS`; it **must** equal
   the contract's `usdt` immutable or every approve/subscribe/disperse reverts.
2. **Deploy the current source against mainnet USDT — DONE.** Deployed at
   `TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha` (tx `4f2bca10…`, 62.71 TRX), wired into the `MAINNET.purserPay`
   block. Note: mainnet deploys/reads **require `TRON_PRO_API_KEY`** (the scripts attach it and throw
   without it on mainnet) — a keyless mainnet call 429s (a keyless deploy can 429 mid-broadcast).
3. **Non-zero-allowance reset — DONE.** `ensureAllowance` (`src/lib/tron/allowance.ts`, wired
   into `disperse.ts` + `subscription.ts`) resets a non-zero-but-short allowance to 0 before
   re-approving (mainnet USDT-TRC20 requires it) and announces the extra prompt. No further work.
4. **Calibrating energy on mainnet — by CONSTANT-CALL SIMULATION (no spend).** The `ENERGY_*` /
   `feeLimitForBatch()` constants in `config.ts` must be calibrated for mainnet or a large batch
   dies `OUT_OF_ENERGY` mid-payroll. A real 3-recipient batch would need a 150-USDT subscription
   (the free tier caps at 1 payee) — so we do **not** broadcast. Instead run
   **`scripts/tron/measure-mainnet.cjs`**: a keyless, read-only script (no `PRIVATE_KEY`, no
   `sign`, no `sendRawTransaction`) that calls `triggerConstantContract` for
   `disperse(address,address[],uint256[])` against the live mainnet contract for N = 1, 2, 3, 5,
   10 and reads back `energy_used`. This is exactly what TronLink uses to quote a fee — no
   signature, no TRX, no USDT moved.

   ```bash
   MEASURE_WALLET=T... node scripts/tron/measure-mainnet.cjs   # needs TRON_PRO_API_KEY (mainnet)
   ```

   Three constraints the script enforces (get any wrong and the number is worthless):
   - **Amounts = 1 base unit (0.000001 USDT) per recipient**, not 1 USDT. On TRON energy does NOT
     scale with the amount — only with whether the recipient's storage slot must be created — so a
     1-unit batch measures the same energy as a 10,000-USDT batch, and the caller's ~1 USDT covers it.
   - **Recipients must be FRESH** (addresses that have never held USDT). A fresh recipient costs
     ~2× (the token writes a brand-new storage slot) — the worst case AND the real case (a new
     affiliate's virgin wallet). Calibrating against existing holders yields ~half the feeLimit
     needed, and the payroll dies exactly when new people are added. The script generates 10 fresh
     keypairs offline, uses only the addresses, and discards the keys. It also simulates N=3 against
     existing holders so the fresh-vs-existing delta is measured, not assumed.
   - **The caller needs a standing allowance to PurserPay** — a constant call still runs the real
     `transferFrom`, which reverts on a zero/short allowance. Approve PurserPay for a small amount
     ONCE (~1.5 TRX one-time tx) from the measure wallet; the script aborts with instructions if
     the allowance is zero (never a garbage number).

   The script solves `PER = (energy(10) − energy(1))/9`, `BASE = energy(1) − PER`, sanity-checks
   linearity against N=2/3/5, and prints the feeLimit @ `BATCH_CAP` (100) with the 1.5×
   `FEE_MARGIN` in energy AND TRX (× the live `getEnergyFee`). Apply the constants **rounded UP** —
   `feeLimit` is a **ceiling, never a charge**; over-provisioning costs nothing, under-provisioning
   kills a payroll, so **when in doubt go high**. Keep the 1.5× margin; relabel the constants
   MAINNET-measured. (For reference, the Nile rehearsal against real Nile USDT measured ~36,925
   energy/recipient, ~3,045 base — mainnet USDT is the same Tether logic, so expect a similar figure.)

   **Caveats (the script prints them; do not bury):** (1) a constant call is a SIMULATION, not a
   receipt — the best estimate without spending, but not a broadcast tx; (2) `getAllowDynamicEnergy
   = 1` on mainnet, so per-contract energy is NOT constant — a heavily-used contract is charged
   progressively more; today's number is a **floor, not a law**; (3) re-verify against a REAL
   receipt the first time a batch runs on mainnet, and re-tune if off. The old `measure.cjs` is
   broken/retired; this constant-call method supersedes both it and the earlier "run one real batch".

   > **Dynamic energy (record only).** `getAllowDynamicEnergy = 1` (threshold 5e9, increase factor
   > 2,000, max 34,000): a heavily-used contract can be charged progressively more. Irrelevant today
   > (brand-new contract, far below the threshold), but if a future batch dies `OUT_OF_ENERGY`
   > despite the margin, this is the first thing to check — not a mystery.
5. **`TRON_PRO_API_KEY` — REQUIRED on mainnet.** Without it, TronGrid rate-limits the gate's
   server-side reads (`serverRead.ts`), `readSubscriptionActive()` returns null, and the gate
   fails **closed** — a paying customer sees the paywall on their payday. `serverRead.ts` therefore
   **throws at boot** on a mainnet build if it's absent (fail loud, never silent). Set it before
   the mainnet deployment. (Optional on Nile.)
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
