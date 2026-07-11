# 06 — Deployment & Operations

> **AI disclaimer — read first.** This document is a *map, not the territory*. If
> anything here conflicts with the source, **the source wins**. Addresses and prices below
> are copied from `src/lib/tron/config.ts` and `scripts/tron/deploy.cjs` — re-read those
> before relying on any value. All paths are repo-relative.

---

## 1. Environments at a glance

- **App:** Next.js on Vercel. Landing `/` (SSR), dashboard `/dashboard` (client-only).
- **Chain:** **TRON Nile testnet** today (the whole switch is one block in `config.ts`).
- **DB:** Supabase (compliance/PII). Roster is device-local (no deploy concern).

## 2. Local dev

```bash
npm install
cp .env.local.example .env.local     # then fill in the values (see below)
npm run dev                          # Next dev server
npm run typecheck                    # tsc --noEmit
npm run build                        # production build (7 routes)
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
  optional `NEXT_PUBLIC_WC_PROJECT_ID`.
- **Server-only:** `SUPABASE_SERVICE_ROLE_KEY`, `WALLET_SALT`, `PII_ENCRYPTION_KEY`.
- **Local deploy only (NOT the running app):** `PRIVATE_KEY` in a gitignored `.env`, read
  by `scripts/tron/deploy.cjs`.

`WALLET_SALT` and `PII_ENCRYPTION_KEY` are **effectively permanent** once compliance data
exists (rotating either is a data-migration event).

## 4. The network seam (`src/lib/tron/config.ts`)

Switching networks is a **config change, not a code change**. The active block:

```ts
NETWORK = { key: "nile", name: "Nile testnet",
            fullHost: "https://nile.trongrid.io", hostMatch: "nile",
            explorer: "https://nile.tronscan.org" }
```

### Current Nile deployment (verified in `config.ts` + `sprint_report.txt`)

| Thing | Value |
| --- | --- |
| `PURSERPAY_ADDRESS` = `DISPERSE_ADDRESS` (same contract) | `TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG` |
| `USDT_ADDRESS` (Nile USDT, Tether USD, 6 dp) | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` |
| `treasuryWallet` (immutable) | `TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2` |
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

```bash
cd contracts && forge build && cd ..          # produce the artifact
node scripts/tron/deploy.cjs                   # DRY preflight — broadcasts nothing
CONFIRM_DEPLOY=1 node scripts/tron/deploy.cjs  # broadcast (after reviewing the plan)
```

Safety properties:

- `PRIVATE_KEY` is read from a gitignored `.env` (dotenv) — **never printed, logged, or
  written**.
- The preflight asserts the signer equals `EXPECTED_DEPLOYER` (Wallet 1) and warns on low
  balance; a mismatch aborts with nothing broadcast.
- After a real deploy it **reads back** the immutables on-chain: `usdt()`,
  `treasuryWallet()`, `owner()`, `SUBSCRIPTION_PRICE()`, `SUBSCRIPTION_PRICE_ANNUAL()`, and
  prints the address to paste into `config.ts`.
- Constructor args (`_usdt`, `_treasuryWallet`) are **immutable** — chosen once, forever.

After deploying, update `src/lib/tron/config.ts` (`PURSERPAY_ADDRESS` **and**
`DISPERSE_ADDRESS` → the new address; move the old one into the superseded comments; record
`owner` + deploy tx) and `scripts/tron/verify-e2e.cjs`. `node scripts/tron/verify-e2e.cjs`
reads the live contract to confirm.

> Because there is **no proxy by design**, any storage-layout or logic change requires a
> **fresh deploy** (that's how the current contract superseded the immutable-fee one).

## 6. Mainnet migration checklist (do NOT flip casually)

Enabling mainnet is more than editing `NETWORK`. Before the switch:

1. **Deploy the same source against mainnet USDT.** Real USDT-TRC20 is
   `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. Set `USDT_ADDRESS` and the constructor `_usdt` to
   it. This **must** equal the contract's `usdt` immutable or every approve/subscribe/
   disperse reverts.
2. **Non-zero-allowance reset.** Mainnet USDT-TRC20 requires resetting a non-zero allowance
   to 0 **before** re-approving. Both `disperse.ts` and `subscription.ts` flag this in
   comments; the Nile mock does not need it. Implement the reset before mainnet payouts.
3. **Re-measure `feeLimit`.** The energy constants in `config.ts` (`ENERGY_*`,
   `feeLimitForBatch`) were measured on Nile. Re-run the measurement (`scripts/tron/`) and
   re-tune against mainnet energy prices so a batch never dies `OUT_OF_ENERGY`.
4. **Decide who holds `owner`.** On Nile it's the deployer (Wallet 1). Since `owner` can
   reprice, mainnet should ideally use a **cold / multisig** wallet; `transferOwnership`
   supports moving it there.
5. Update the `NETWORK` block (`fullHost: https://api.trongrid.io`, `hostMatch:
   "api.trongrid"`, `explorer: https://tronscan.org`), re-verify, and re-run typecheck +
   build + `forge test`.

## 7. Verification after any change here

```bash
npm run typecheck && npm run build     # app compiles, all routes generate
cd contracts && forge test -vv         # 26 pass
node scripts/tron/verify-e2e.cjs       # live contract reads as expected
```

For copy/architecture consistency during the ongoing Vite→Next migration, both auditors
(`copy-auditor`, `ux-auditor`) verify parity — see `CLAUDE.md`.
