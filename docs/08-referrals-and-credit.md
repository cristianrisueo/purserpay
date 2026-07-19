# 08 — Referrals & Off-Chain Credit

> **AI disclaimer — read first.** This document is a _map, not the territory_. If
> anything here conflicts with the source, **the source wins**. Cross-check against the
> referenced files before refactoring, and keep this doc in the same change that alters
> the behavior it describes. All paths are repo-relative.

---

## Status (Sprint 2) — the agency→agency INVITE UI is RETIRED; the credit infra is FROZEN

> The **agency→agency** cold referral — a paying 150-USDT/mo agency inviting **another agency**
> for a free credit month — is **dead by STRUCTURAL CONFLICT OF INTEREST**: a CPA/OFM agency does
> not hand its direct competitor the tool. **Record the reason as the conflict of interest, NOT
> "the incentive was too small"** — otherwise someone later "fixes" it by raising the reward and
> rebuilds a channel that was structurally dead from the start.
>
> What changed: the **dashboard invite card** (`src/components/dashboard/ReferralCard.tsx`) was
> **removed** — the only surface that promoted the agency→agency invite. **Nothing else changed.**
> The credit **infrastructure is FROZEN, not dropped**: the `referral_accounts` / `referral_rewards`
> schema, the credit columns, and the entire claim path (§7) all stay; existing credit is still
> **honored monotonically** (§4); `REFERRALS_ENABLED` is unchanged (still default OFF). The claim
> path is deliberately kept **live** because the **affiliate→agency** bounty
> ([`09`](./09-affiliate-portal.md)) rides on it — see below.
>
> **This did NOT kill referrals as a channel.** The **affiliate→agency** vector (a *payee* — a
> model/contractor — referring the agencies they work with, [`09`](./09-affiliate-portal.md)) is a
> **different, LIVE** vector: a payee is not a competing agency, so no conflict of interest. It
> reuses the **same** `/r/{code}` + `referral_accounts` plumbing (an affiliate is a
> `referral_accounts` row with `is_affiliate = true`) and is **unaffected** by removing the agency
> card. Other agency-side vectors — agency → a **non-competing** partner / supplier / a colleague in
> another geography — are **POSTPONED, not killed**, pending real trench data.

---

## 1. What it is

An **asymmetric referral loop**. A paying customer shares an opaque link
(`{origin}/r/{code}`). When someone they invited **pays for their first month
on-chain**, the referrer banks **one free month** as off-chain **credit**. The invitee
gets **nothing** — full price, no discount. It exists to lower CAC without touching the
non-custodial money path or the contract.

## 2. THE ONE ANTI-FRAUD PROPERTY — never break it

> **Reward (1 month = 150 USDT) == cost of manufacturing a referee (150 USDT paid
> on-chain).**

Self-referral is a mathematical `x = x`: to earn a month you must cause a **real** 150
USDT on-chain subscribe by a **different** wallet. Zero margin. This 1:1 ratio is the
**entire** anti-fraud design.

**NEVER make the reward bigger than the price.** A future "3 referrals = 1 year free"
would pay 12 months (1,800 USDT of value) for 3 referees (450 USDT of cost) — a **233%
self-referral margin**, i.e. a money printer. If you change the reward size, keep
`reward_value ≤ referee_cost` per referral. The reward is fixed at **exactly one 30-day
month per qualified referral** for this reason.

## 3. The entitlement model

The payout gate used to read the chain only. It now reads:

```
entitled(wallet) = onChainActive(wallet) || creditActiveUntil(wallet) > now()
```

Credit is a **balance of months** (`credit_balance_months`), **lazily consumed** at pay
time (`src/lib/freeTier/gate.ts` → `authorizePayout`, via the `checkCredit` dep wired in
`src/app/api/payout/authorize/route.ts` → `consume_referral_credit`):

- **`onChainActive` → entitled. Credit is left BANKED (never touched).**
- else **a credit month already running** (`credit_active_until > now`) → entitled, **no
  decrement**.
- else **`credit_balance_months > 0`** → **atomically** decrement by 1, set
  `credit_active_until = now() + 30 days` → entitled.
- else → not entitled → fall through to the existing **free-tier quota**
  ([`07`](./07-freemium-gate.md)).

**Lazy consumption is why there is NO indexer, cron, listener, or webhook.** Stacking
works for free: 12 banked months = 12 months queued behind whatever is already paid, each
activated only when the previous access lapses and the wallet next tries to pay. The chain
stays the **source of truth for PAYMENTS**; credit is purely additive **access** on top —
the contract is unchanged and unaware of it.

`subscribe()` on-chain **RESETS** expiry (`now + period`, see
[`05`](./05-smart-contract.md)); credit is off-chain and **additive**. The two are
independent clocks OR-ed together.

### The `allowActivation` rule (never burn a banked month on uncertainty)

The server chain read (`readSubscriptionActive`) is tri-state: `true` / `false` /
`null` (unverifiable — undeployed or RPC error). `consume_referral_credit(hash,
allowActivation)` is called with `allowActivation = (onChain === false)`:

- `false` (definitively inactive) → activation allowed; a banked month may be consumed.
- `null` (unverifiable) → activation **disallowed**; we only **honor an already-running
  month**, never start a new one on a wallet that might actually be subscribed on-chain.

If the chain is `null` **and** there's no running credit month **and** no other
entitlement, the gate fails **closed** (`SUBSCRIPTION_UNVERIFIABLE`) exactly as before.

### Why the chain stays authoritative for paid time

**`subscriptionExpiresAt` on the contract is the sole source of truth for PAID time; the
backend never becomes authoritative for it.** The backend only ever learns a payment
happened because the **client reports the txid after signing** (`claimReferral` →
`/api/referral/claim`). If the tab closes, the network blips, or a user calls `subscribe()`
directly with TronWeb, the backend never sees it — and a backend-tracked expiry would then
show an EXPIRED subscription to a customer who really paid 150 USDT on-chain. That would
**DENY** entitlement to a paid customer, violating the grant-only invariant (§4), and closing
the gap would require a chain **indexer/listener** (reorgs, retries, idempotency,
reconciliation) — explicitly out of scope.

So the two clocks keep separate owners: **the chain owns paid time** (`subscriptionExpiresAt`,
read via `getSubscriptionStatus` / `readSubscriptionActive`), **Supabase owns credit**
(`credit_active_until` / `credit_balance_months`). The dashboard header
(`src/components/dashboard/DashboardHeader.tsx`) states entitlement in ONE line but reads the
**paid** date from the chain and only labels a running credit month from Supabase — it never
projects a banked-month end date (lazy consumption has no cron, so there is no precise future
date to promise).

## 4. Monotonic — the credit system can only GRANT, never DENY

A bug here must be able to gift a month, **never** lock out a customer who paid on-chain.
Enforced structurally:

- The gate checks `onChainActive` **first** and returns entitled without ever consulting
  credit — an on-chain subscriber is never affected by the credit tables.
- Credit consumption only **decrements** (guarded `> 0`, plus a `CHECK
  (credit_balance_months >= 0)`); a reward only **increments**. Neither can reduce access
  below what the chain grants.
- Existing credit is honored **regardless of `REFERRALS_ENABLED`** — flipping the kill
  switch off stops *new grants*, never *earned access*.

## 5. The Active-Lock resolution (`code valid ⟺ referrer entitled`)

A referrer living on free months has an **expired on-chain subscription** — their code
must stay alive. So reward eligibility keys on `entitled(referrer)`, **not**
`onChainActive(referrer)`.

But we store only the referrer's **`wallet_hash`**, never the raw address, so
`readSubscriptionActive` (which needs the address) **cannot** be called on a referrer at
claim time. The Active-Lock therefore uses a **hash-computable proxy**
(`claim_referral_reward`):

```
referrer entitled ⟺ first_paid_at IS NOT NULL       -- has ever paid real money
                  OR credit_active_until > now()      -- a free month is running
                  OR credit_balance_months > 0        -- has months banked
```

`first_paid_at` is set on **any** verified on-chain subscribe (through our UI), so "has
ever paid" is a durable signal. Being generous here is **monotonic-safe** (it only ever
grants more rewards, never denies access). A never-paid, no-credit wallet is **not**
entitled → its code earns nothing (blocking a free farmer).

## 6. Credit months NEVER generate rewards

Only a **real on-chain payment** earns a reward. A month activated from credit has **no
subscribe transaction**, so it can never satisfy the claim's step 1 (a verified on-chain
`subscribe` tx). This is what keeps the loop from printing money: N credit months don't
beget N more.

## 7. The claim flow (`/api/referral/claim`)

Fired best-effort by the client after a confirmed subscribe (`usePayout.subscribe` and
`PricingSection.handleConfirmAndPay` → `claimReferral`). **Any failure returns 200
`{ granted:false }`; a failed reward NEVER breaks or rolls back the subscription.** Two
untrusting guards: the referrer comes **only** from the server-read `pp_ref` cookie (never
the client), and the payment is **re-verified on-chain**:

1. **`verifySubscribeTx(txid, refereeAddress)`** (`src/lib/tron/serverRead.ts`, reusing the
   keyless `serverClient()`): mined-success **and** `to == PurserPay` **and** selector ==
   `subscribe(uint8)` (`0x49c7e639`) **and** `owner == refereeAddress`. `getTxOutcome`
   alone proves success but not contract/method/sender — the reward's anti-fraud depends on
   binding it to a genuine subscribe by this referee, so this inspects the tx's call data.
2. **`ensureReferralAccount`** the referee (every subscriber becomes a valid future
   referrer, with an opaque code).
3. **`claim_referral_reward`** (one transaction): mark `first_paid_at` (idempotent) + bind
   `referred_by_code` immutably (attribution — runs even when rewards are disabled), then
   grant **only if** first paid month **and** enabled **and** referrer resolves **and** not
   self **and** referrer entitled → `INSERT referral_rewards` (`txid` PK + `referee_wallet_hash`
   UNIQUE → idempotent) → `credit_balance_months += 1`.

**Wallet-control proof — deliberately NOT a signature challenge here (owner decision).** The
payout gate proves the caller controls the payer wallet with a single-use signature challenge
([`07`](./07-freemium-gate.md) §4a). The claim flow does **not**: it relies on
`verifySubscribeTx` (step 1), where `owner_address == refereeAddress` already proves the
referee controlled that wallet when they signed the on-chain subscribe — a stronger, cheaper
proof that costs the user no extra prompt. **Residual, accepted limitation:** a post-hoc
*attribution-theft race* — an attacker who front-runs the referee's own auto-fired claim, using
the referee's public `txid` with the attacker's own `pp_ref` cookie, could bank themselves the
month. Low severity: it needs `REFERRALS_ENABLED` **on** (default off), a race against a claim
the referee's client fires within seconds of confirmation, and it steals only one referral
month (never the referee's subscription or funds). A live claim-signature challenge would close
it and is the natural hardening for referral launch; it was scoped out here to keep the
subscribe flow to a single signature.

**Observability.** Because every path returns 200, a silent non-grant is undebuggable. The
route emits **one structured server-log line per outcome** with a distinct code — `SUCCESS`,
`NO_REF_COOKIE`, `CODE_NOT_FOUND`, `TX_VERIFY_FAILED` (with the txid + the tx's decoded
`to` / `selector` / `owner`, via `verifySubscribeTx`'s returned fields), `SELF_REFERRAL`,
`REFEREE_ALREADY_REWARDED`, `REFERRER_NOT_ENTITLED`, `REFERRALS_DISABLED`. Expected,
high-volume outcomes (a subscribe with no referral cookie, a renewal, a disabled switch) log
at `info`; anomalies at `warn`. The lines carry only **public on-chain data** (txid, tx
fields) and the **public share code** — no PII, no secrets.

## 8. Attribution (`/r/{code}`) — the one irreversible bit

`src/app/r/[code]/route.ts` validates the code exists, then sets cookies and 302s to `/`.
**Three cookies, distinct jobs:**

- **`pp_ref`** = the code — **HttpOnly**, SameSite=Lax, 30d. The server reads it at claim
  time; the client never can, and a client-supplied referrer is never trusted. **FIRST-TOUCH:
  set only if absent, never overwritten. Its 30-day TTL is LOAD-BEARING for attribution — an
  invitee typically browses, leaves, and subscribes days later, so DO NOT shorten or clear it.**
- **`pp_invited`** = `"1"` — **readable**, drives only the landing's `InvitedBanner` (the
  HttpOnly code can't be read client-side). Re-set on every valid visit. Leaks no code and
  keeps the landing statically rendered.
- **`pp_invited_dismissed`** = `"1"` — **readable**, set by the banner's X close control. A
  **UI preference ONLY, with zero effect on attribution** (it never touches `pp_ref`). The
  banner shows iff `pp_invited` is present AND `pp_invited_dismissed` is absent; `/r/{code}`
  **deletes** it on a valid visit so a new referral link re-shows the banner.

Attribution runs **regardless of `REFERRALS_ENABLED`** — an uncaptured click is lost
forever, whereas rewards are optional and can be switched on later.

## 9. Data model & dissociation

`supabase/migrations/0003_referrals.sql` — `referral_accounts` (wallet_hash PK,
referral_code UNIQUE, referred_by_code, credit_balance_months, credit_active_until,
first_paid_at) and `referral_rewards` (txid PK, referrer/referee hashes, referee UNIQUE).

- **RLS on, no policies** → only `service_role` (the route handlers) touches them.
- **`wallet_hash` is a salted SHA-256** — the SAME `WALLET_SALT` pepper + trim-only
  normalization as the free tier / OFAC (`src/lib/crypto.ts`). No raw address, **no PII**,
  no FK to `billing_profiles`; the shared pseudonymous hash reveals no identity (same
  posture as `free_tier_usage`, see [`04`](./04-compliance-and-encryption.md)).
- **`referral_code` is opaque + random** (`src/lib/referral/code.ts`, CSPRNG, unambiguous
  alphabet) — **NEVER derived from the wallet address** (a wallet-as-code would doxx the
  payout treasury).
- **No TTL/purge** — a referral account is the customer's durable referral identity
  (unlike the 30-day free-tier rows).

## 10. Kill switch — `REFERRALS_ENABLED`

`src/lib/referral/config.ts` → `referralsEnabled()`, server-only, **default OFF**. Off:
`/r/{code}` still sets the cookie (attribution), the gate still **honors existing credit**
(monotonic), but no new agency reward is granted. On: the credit-reward mechanic runs.

> **Sprint 2:** the agency dashboard invite card was **removed**, so there is no longer a UI
> that *promotes* the agency→agency invite — flipping `REFERRALS_ENABLED` on no longer surfaces a
> "share your link" card to agencies. The switch still governs whether the **claim path** grants an
> agency credit month, and still leaves attribution + monotonic honoring of existing credit
> untouched. The **affiliate** bounty write ([`09`](./09-affiliate-portal.md)) is a separate path
> and is not governed by this switch.

## 11. Files

| Concern | File |
| --- | --- |
| Schema + RPCs (ensure / consume / claim / summary) | `supabase/migrations/0003_referrals.sql` |
| Opaque code generator | `src/lib/referral/code.ts` |
| Server adapters (hash, ensure, consume, claim, summary, exists) | `src/lib/referral/accounts.ts` |
| Kill switch | `src/lib/referral/config.ts` |
| Client fetch (claim + summary) | `src/lib/referral/claimClient.ts` |
| On-chain subscribe-tx verifier | `src/lib/tron/serverRead.ts` → `verifySubscribeTx` |
| Gate credit dep | `src/lib/freeTier/gate.ts` (`checkCredit`) + `src/app/api/payout/authorize/route.ts` |
| Attribution / claim / summary routes | `src/app/r/[code]/route.ts`, `src/app/api/referral/{claim,summary}/route.ts` |
| Invited banner (landing receiving-end of any `/r/{code}`) | `src/components/landing/InvitedBanner.tsx` |
| ~~Agency dashboard invite card~~ | **REMOVED in Sprint 2** (`src/components/dashboard/ReferralCard.tsx` deleted — agency→agency dead by conflict of interest). Running/banked credit is still shown by `src/components/dashboard/DashboardHeader.tsx`. |
| Client wiring | `src/hooks/usePayout.ts`, `src/components/landing/PricingSection.tsx` |
| Tests | `tests/referral/entitlement.test.ts`, `tests/referral/claim.integration.test.ts`, `tests/referral/credit.toctou.integration.test.ts` |
