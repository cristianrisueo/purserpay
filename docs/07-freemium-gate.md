# 07 — The Free-Tier Gate

> **AI disclaimer — read first.** This document is a _map, not the territory_. If
> anything here conflicts with the source, **the source wins**. Cross-check against the
> referenced files before refactoring, and keep this doc in the same change that alters
> the behavior it describes. All paths are repo-relative.

---

## 1. What it is

> **Free Tier: one (1) payee per payer wallet, once every 30 days. Forever.**
> Everything else requires the 150 USDT/mo subscription.

It is a **mainnet smoke test, not a product tier** — it lets a prospect prove, on
mainnet, with THEIR wallet and THEIR real recipient, that the money actually moves (the
one thing a testnet can't prove). It is deliberately just enough to build trust and no
more.

### Why there is no testnet sandbox (DISCARDED — do not reopen)

**Owner decision: a testnet sandbox / demo environment is discarded, not deferred — it will
never be built.** The mainnet free tier above does the sandbox's job strictly better: it
proves the product with the user's **real** wallet and **real** money, which a testnet
cannot. It also has **less** friction — a sandbox would require the user to add Nile to
TronLink and find a faucet, more steps than connecting the wallet they already use. And it
would add a permanent second network configuration — a standing bug surface across expiry
dates, contracts, balances, and receipts — in exchange for an inferior demo. Discarded. (See
the "Discarded — do not reopen" list in [`README.md`](./README.md). This is separate from
Nile being the *current dev/deploy network* in `config.ts`, which stays.)

## 2. The load-bearing structural fact

`disperse()` is **permissionless and immutable** (`contracts/src/PurserPay.sol` — no owner
gate, no fee, no subscription check). **This gate CANNOT be enforced on-chain and we do
not try.** It is an **off-chain software-licence gate, exactly like OFAC** — enforced in a
route handler, not in the contract. See [`05-smart-contract.md`](./05-smart-contract.md) §
"free tier".

## 3. Why the PAYER wallet, never the recipient

The quota is anchored on a salted hash of the **payer** wallet **only**. Anchoring on
recipients was rejected: it would require a **global registry of other people's payee
wallets** to know whether a given recipient had "already been used" — a standing database
of third parties who never consented and are not our users. That is a GDPR liability we
refuse. The payer is our actual user, and their own wallet is the natural licence key.

Consequence (accepted): the same person can open a second wallet and get a second free
payout. That's fine — it costs them a fresh wallet + funding per payout, and it still runs
through OFAC, receipts, and the invoice. The free tier is a trust-builder, not a vault.

## 4. Data model (`supabase/migrations/0002_free_tier_usage.sql`)

```
free_tier_usage
  payer_wallet_hash   text  primary key   -- salted SHA-256 (WALLET_SALT), NEVER the raw addr
  last_free_payout_at timestamptz
  created_at          timestamptz
```

- **Salted-hash only**, same `WALLET_SALT` pepper + trim-only normalization as OFAC
  (`src/lib/crypto.ts`). The raw address never lands in the DB.
- **RLS on, no policies** → only `service_role` (the route handlers) can touch it; the
  browser never can. Access is via three `security invoker` RPCs (`consume_free_tier`,
  `release_free_tier`, `purge_free_tier_usage`), mirroring the 0001 schema style.
- **60-day TTL purge** (`purge_free_tier_usage`, scheduled via pg_cron with a documented
  Vercel-cron fallback): the gate needs only 30 days of history; 60 gives margin, then the
  row is deleted. Data minimization.
- **Out of scope for Art. 17 erasure.** This table holds no PII and is **not linked to the
  account holder** (that dissociation is intentional). The erasure path wipes
  `billing_profiles`; `free_tier_usage` is governed by the TTL, not erasure. See
  [`04-compliance-and-encryption.md`](./04-compliance-and-encryption.md) §6.

## 4a. Proving wallet control (Gate 0 — runs before everything)

The authorize route acts on a **client-supplied** `payerAddress`, and wallet addresses are
**public on-chain**. Without proof of control, anyone could POST a paying customer's address
and consume that customer's free-tier slot — or burn a banked referral credit month (150 USDT
of value). So before OFAC, the subscription read, or **any** quota/credit consume, the caller
must prove it controls the payer wallet with a **single-use signature challenge**.

This is **not an auth system** (no magic link, no session, no cookie — those stay unbuilt). It
is a wallet-signature challenge, the most native crypto flow:

1. **Issue** — `GET /api/payout/challenge?address={addr}` (`src/app/api/payout/challenge/
   route.ts` → `issueChallenge`): mint a CSPRNG nonce (`node:crypto`), store `{nonce,
   wallet_hash, expires_at}` (5-minute TTL, `used_at` null) in `payout_challenges`, and return
   the exact message to sign (`cache-control: no-store`). The message is TIP-191 / human-readable:
   ```
   PurserPay — authorize payout
   Address: {addr}
   Nonce: {nonce}
   Expires: {iso8601}
   ```
2. **Sign** — the client signs that message with its connected wallet (`signMessageV2`; one
   prompt, no funds move — `src/lib/tron/wallet.ts` → `signMessage`, via
   `src/lib/payout/challengeClient.ts` → `proveWalletControl`).
3. **Verify (in authorize, FIRST)** — the route (`verifyChallenge` → the pure
   `src/lib/payout/challengeVerify.ts` → `verifyWalletControl`):
   - **Atomically consumes** the nonce — `consume_payout_challenge(nonce, hash(payer))`, a
     single guarded `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING expires_at`
     (Postgres row-locks → **N concurrent → exactly one wins**; the whole replay + TOCTOU
     defense, mirroring `consume_free_tier`). No row → **403** (unknown / used / expired /
     wrong-address).
   - **Reconstructs** the exact signed message from the payer, the nonce, and the stored expiry,
     **recovers the signer offline** (`serverRead.ts` → `recoverMessageSigner`, TronWeb
     `verifyMessageV2` — keyless ec-recover, no network), and asserts it equals the payer.
     Mismatch → **403**.

**Acceptance:** an attacker can obtain a nonce for a victim's address (it's public) but cannot
sign the message → the consume burns only a nonce the attacker requested, the signer mismatch
returns **403, and nothing downstream is touched.** The victim's slot/credit is never consumed.
A signature failure returns before `authorizePayout`, so it can **never** burn a slot or a
credit month.

**Storage/dissociation:** `payout_challenges` (`supabase/migrations/0004_payout_challenges.sql`)
holds only the salted `WALLET_SALT` hash (same pepper as OFAC/free-tier/referral) + an ephemeral
nonce + a short expiry — **no PII, no raw address**. RLS on / no policies; `security invoker`
RPCs; service-role only; a 1-day TTL purge. **No new env var** — reuses `WALLET_SALT`, the
service-role client, and the keyless server TRON client. See
[`04`](./04-compliance-and-encryption.md) §6d.

**Known/accepted:** the challenge endpoint is a side-effecting `GET` (each call mints a fresh
nonce) — intentional and safe with `cache-control: no-store`. An attacker can burn nonces they
themselves requested (meaningless; nonces are ephemeral and cheap). Only the **payout authorize**
path is challenge-gated; `/api/referral/claim` still relies on the on-chain subscribe-tx proof
(its `owner_address` must equal the referee) — see [`08`](./08-referrals-and-credit.md) §7.

## 5. The request path (three route handlers)

`src/lib/freeTier/gate.ts` holds the pure, dependency-injected DECISION
(`authorizePayout`); the routes wire the real dependencies. `GET /api/payout/challenge` mints
the wallet-control challenge (§4a).

### `POST /api/payout/authorize` → `{ payerAddress, recipientCount, recipientAddresses[], nonce, signature }`

`nonce` + `signature` prove wallet control (§4a) and are checked **first**: a missing pair →
**403 `WALLET_PROOF_REQUIRED`**; a failed recovery/consume → **403 `WALLET_PROOF_FAILED`**,
nothing consumed. Only a proven caller reaches `authorizePayout`, whose order is:

1. **OFAC** — screen ALL `recipientAddresses` (`src/lib/compliance/ofac.ts` →
   `screenRecipients`, the SAME core the roster-wide screen uses). A hit → **403**
   `{ code: "OFAC_BLOCKED", flagged }`.
2. **Subscription** — read `isSubscriptionActive(payer)` **server-side via TronGrid**
   (`src/lib/tron/serverRead.ts`, keyless, non-custodial). Active → **200**
   `{ mode: "subscription" }`, unlimited, **quota untouched**. Unverifiable (undeployed /
   RPC error → `null`) → **503**, nothing consumed (never burn a real subscriber's slot).
3. **Free tier** —
   - `count > 1` → **402** `{ code: "FREE_TIER_BATCH_LIMIT" }`.
   - `count === 1` → **atomically consume** the quota. Row → **200**
     `{ mode: "free", consumedAt }`. No row → **402**
     `{ code: "FREE_TIER_COOLDOWN", nextAvailableAt }`.

**Count authority:** the server uses `recipientAddresses.length`, never the client's
`recipientCount` field — a client can't send 5 addresses while claiming 1.

### Atomic consume — the whole TOCTOU defense

The slot is consumed **OPTIMISTICALLY, BEFORE the client broadcasts** (never after
confirmation — TRON's ~3s block time gives a window in which parallel batches would all
pass a naive check). The defense is a **single SQL statement** (`consume_free_tier`):

```sql
insert into free_tier_usage (payer_wallet_hash, last_free_payout_at)
values ($1, now())
on conflict (payer_wallet_hash) do update
  set last_free_payout_at = now()
  where free_tier_usage.last_free_payout_at <= now() - interval '30 days'
returning last_free_payout_at;
```

Postgres row-locks the conflict target, so **N concurrent requests → exactly one row
returned**. **Never** a `SELECT`-then-`INSERT`. Proven by
`tests/freeTier/toctou.integration.test.ts` (N concurrent → exactly one win).

### `POST /api/payout/release` → `{ payerAddress, txid | null, consumedAt }`

The refund path, so a mistake never burns the one free slot:

- The decision is the pure `shouldRestoreSlot` (`src/lib/freeTier/refund.ts`):
  - `txid === null` (wallet rejected, nothing broadcast) → **restore**.
  - `txid` present → re-verify on-chain (`getTxOutcome`, server-side). Restore **only** on a
    proven `"failed"`. `"success"` (money moved) or `"unknown"` (can't confirm) → **fail
    closed, do NOT restore.** Never trust a client claim of failure.
- Restore = `release_free_tier(hash, consumedAt)`, which deletes only the exact consume it
  identifies (guarded by `consumedAt`), so a newer consume is never wiped. A subscriber
  never consumed a slot, so never calls this.

The client (`src/hooks/usePayout.ts` → `runPayment`) captures the broadcast txid and, on a
failed/rejected free-mode payout, calls release with `txid` (or `null`).

## 6. The client (free mode)

`usePayout` derives `freeMode = connected && !wrongNetwork && subscriptionActive === false`
(never `null`, the loading state — we don't cap or nag until we know). In free mode:

- **Import stays FULL** — a 200-row CSV imports, validates (✓/✓✓), and is **fully OFAC
  screened** (roster-wide, `rowOfacFlagged`); sanctioned rows are flagged red. Never
  truncated — this is the value demo.
- **Selection caps to ONE** (radio behavior in the setter); the select-all header is hidden.
- **"Pay all" is locked**, replaced by a **Subscribe** CTA (never a bare disabled button).
- **Cooldown** renders a calm countdown ("Next free payout in N days") + Subscribe CTA
  (`src/components/dashboard/FreeTierBanner.tsx`).
- The **fiscal form is NOT on the free path** — the dashboard route guard now admits any
  connected wallet, and the fiscal form lives only in the subscribe/checkout flow
  (`SubscribeDialog`). See [`04`](./04-compliance-and-encryption.md) §"fiscal data at
  checkout".

**Discoverability:** the landing **Pricing** section
(`src/components/landing/PricingSection.tsx`) carries a short explainer of the free tier
below the plan card, and the nav CTA's **"Go to Dashboard"** state routes a connected,
unsubscribed wallet straight into free mode. Every claim in that copy maps to a rule above
(full import + roster-wide OFAC screen · one payee / 30 days · subscribe to lift the cap).

## 7. Known and accepted limitations

- **Direct-contract bypass (accepted, unclosable by design).** A determined user can call
  `disperse()` directly with TronWeb and skip the gate entirely — losing OFAC screening,
  receipts, and the invoice (the actual product). We do **not** try to close this; it is
  the flip side of the permissionless/immutable `disperse` that makes the whole app
  non-custodial. Do **not** propose a contract change to gate `disperse`.
- **`release(txid = null)` trusts the client's "I rejected" claim.** With no broadcast
  there is nothing on-chain to verify, so the server restores on request. A determined
  user could broadcast a successful disperse and then claim `null` to reclaim the slot —
  but that grants nothing beyond the direct-contract bypass above (they could just call
  `disperse` directly). We accept it to honor "don't burn a slot on a wallet rejection"
  (a real misclick must be forgiven). An optional future hardening is a bounded
  recent-transaction scan of the payer → contract; not built.
- **Second-wallet duplication (accepted).** See §3 — anchoring on the payer, not
  recipients, is the deliberate GDPR-safe choice.

## 8. Files

| Concern                        | File                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Pure decision + refund logic   | `src/lib/freeTier/gate.ts`, `src/lib/freeTier/refund.ts`                               |
| Quota adapter (RPCs)           | `src/lib/freeTier/quota.ts`                                                            |
| Wallet-control proof (Gate 0)  | `src/lib/payout/challenge{,Message,Verify,Client}.ts` (pure decision + server + client) |
| OFAC screen core (shared)      | `src/lib/compliance/ofac.ts`                                                           |
| Server TRON reads (sub + txid + signer recover) | `src/lib/tron/serverRead.ts`                                          |
| Routes                         | `src/app/api/payout/{challenge,authorize,release}/route.ts`                            |
| Client wiring                  | `src/hooks/usePayout.ts`, `src/lib/freeTier/authorizeClient.ts`, `src/lib/tron/wallet.ts` (`signMessage`) |
| Free-mode UI                   | `src/components/dashboard/FreeTierBanner.tsx` + PayoutControls/columns/DashboardHeader |
| Schema                         | `supabase/migrations/0002_free_tier_usage.sql`, `0004_payout_challenges.sql`           |
| Tests                          | `tests/freeTier/{gate,toctou.integration}.test.ts`, `tests/challenge/{message,verify,challenge.integration}.test.ts` |
