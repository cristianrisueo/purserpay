# 09 — Affiliate portal (payee-facing receipt history + referral bounty)

> **Status: Sprint 1A skeleton + 1B receipt PDF + 1C Flex Card.** 1A shipped the portal, the
> signature gate, the disperse-anchored receipt index, and a grant-only bounty ledger. **1B (§5)**
> adds the per-receipt **PDF proof of source of funds** and its **public verification page**
> (`/verify`). **1C (§6)** adds the shareable **Flex Card** image (viral-loop validation). The
> bounty *engine* (auto-accruing months) still does not ship.
>
> **⚠ This whole growth system rides on an UNVERIFIED hypothesis** — that a payee values the
> receipt, and that the bounty gives them leverage to move their *other* agencies onto
> PurserPay — pending the first real customer conversation. It is a bet, built cheaply.

## What it is (one paragraph)

A **payee**-facing page (an OFM model / contractor who *receives* USDT payouts through an
agency's PurserPay). At one fixed URL — [`/portal`](../src/app/portal/page.tsx) — the payee
proves they control their wallet with **one signature** and sees their **disperse-anchored
payout history**: proof they were paid through PurserPay. Below that value sits a viral banner
(copy only) and their own opaque **referral link**, dangling a **manual** bounty (50 USDT/mo ×
6 per referred agency). The portal **reads**; it never signs a payout, never holds funds, never
touches the non-custodial money path.

## The route model — `/portal`, not `/r/[code]`

- [`/portal`](../src/app/portal/page.tsx) is **one URL for every affiliate**. There is **no
  code in the URL and no cookies**. Identity comes from the **signature** (resolved to
  `hash(signer)` server-side), never from the link. A pasted wallet renders nothing because
  there is no wallet-addressable route at all — the airtight anti-leak.
- [`/r/[code]`](../src/app/r/[code]/route.ts) is **untouched**. It remains the
  first-touch attribution route handler (sets `pp_ref`/`pp_invited`, 302s to `/`). The
  affiliate's *share* link still points at `/r/{code}` — that is how a referred agency gets the
  attribution cookie. Portal ≠ share link.
- **This affiliate→agency vector is LIVE and independent of the (retired) agency→agency invite.**
  Sprint 2 removed the *agency dashboard* referral card (a paying agency inviting a competitor —
  dead by conflict of interest; see [`08` Status](./08-referrals-and-credit.md)). That removal does
  **not** touch this portal: `/r/{code}` and `referral_accounts` are **shared plumbing** — an
  affiliate is a `referral_accounts` row with `is_affiliate = true` — and the affiliate's code
  keeps resolving through the exact same route and table. Removing the agency card changed **no**
  affiliate path (attribution, the bounty claim, the Flex Card QR all keep working).
- Like `/dashboard`, `/portal` is `"use client"` + `dynamic(ssr:false)` — it reads the injected
  wallet and tronweb, neither of which exists during SSR.

## §1 — The signature gate (reuses the payout challenge primitive)

The portal REUSES the exact wallet-control challenge that gates payouts
([`docs/07`](./07-freemium-gate.md) §4a) — **the same nonce table
([`payout_challenges`](../supabase/migrations/0004_payout_challenges.sql)), the same atomic
consume RPC, the same offline ec-recover**. It is NOT a second challenge system.

The only difference is a **purpose** threaded through the message builder
([`challengeMessage.ts`](../src/lib/payout/challengeMessage.ts)):

| purpose | first line | verifier |
| --- | --- | --- |
| `payout` (default) | `PurserPay — authorize payout` | [`/api/payout/authorize`](../src/app/api/payout/authorize/route.ts) |
| `portal` | `PurserPay — verify wallet to view receipts` + *"authorizes no payment or on-chain action"* | [`/api/affiliate/portal`](../src/app/api/affiliate/portal/route.ts) |

`buildChallengeMessage` / `issueChallenge` / `verifyChallenge`
([`challenge.ts`](../src/lib/payout/challenge.ts)) / the GET
[`/api/payout/challenge?purpose=`](../src/app/api/payout/challenge/route.ts) /
[`proveWalletControl`](../src/lib/payout/challengeClient.ts) all take a defaulted
`purpose` — the payout path is byte-for-byte unchanged.

**Why the purpose needs no DB column — it is bound cryptographically.** The purpose lives only
in the signed bytes. A signature over the portal message, replayed to the payout gate, is
verified against the (different) payout message, so ec-recover yields the **wrong signer** →
`signer_mismatch` → rejected (and vice-versa). Both ends simply agree on the purpose. This is
exercised over real HTTP + real crypto in [`tests/affiliate/message.test.ts`](../tests/affiliate/message.test.ts).

**The flow** ([`portalClient.ts`](../src/lib/affiliate/portalClient.ts) →
[`/api/affiliate/portal`](../src/app/api/affiliate/portal/route.ts)): connect wallet → sign the
portal challenge (one prompt) → POST `{ address, nonce, signature }`. `verifyChallenge(…,
"portal")` recovers the signer and asserts it equals `address`. **Only on ok** does the route
return data, keyed on `hash(signer)`. A missing / invalid / replayed / expired signature → a
uniform **403 with an empty body** — no partial render, and no leak of whether any record
exists. It is **one** signature-gated endpoint (not a per-widget split) so the payee signs
**once** (Law of UX #1).

## §2 — Disperse-anchored receipts (the doctrine change)

**B5:** a receipt exists ONLY if it passed through PurserPay's `disperse` contract, sourced
from OUR records — **never a generic "USDT transfers to this address" chain scan.**

PurserPay keeps **no** server record of who was paid: the roster is device-local (Dexie) and the
on-chain `Dispersed(payer, token, count, total)` event
([`abi.ts`](../src/lib/tron/abi.ts)) carries **no per-recipient data**. So a per-recipient
history cannot be read from the chain — it needs a **new server-side index**, populated **going
forward**. This is a real, deliberate modification of the "roster never leaves the device"
invariant, and it is called out here and in [`CLAUDE.md`](../CLAUDE.md).

### The invariant, restated precisely

- The **ROSTER** (the names + wallets the agency *types* into the app) **still never leaves the
  device.** Untouched.
- [`disperse_receipts`](../supabase/migrations/0005_affiliate_portal.sql) is a **different
  thing**: a *dissociated, hashed, forward-only* index. It stores
  `hash(recipient) + amount + payer + txid` — **no names, no cleartext recipient wallets**. The
  payer (agency) wallet is stored in the clear because it is **public on-chain** and the payee
  needs to see who paid them.

### Recording (going forward)

1. After a batch confirms, [`usePayout`](../src/hooks/usePayout.ts) `onBatchConfirmed` fires a
   best-effort [`recordDisperse(txid)`](../src/lib/affiliate/recordClient.ts) — sibling to the
   device-local `addReceipt`. It POSTs **only the public txid** to
   [`/api/affiliate/record`](../src/app/api/affiliate/record/route.ts).
2. The server calls [`verifyDisperseTx(txid)`](../src/lib/tron/serverRead.ts) — modeled on
   `verifySubscribeTx`. It asserts the tx is **mined + successful**, a `TriggerSmartContract`
   call **to PurserPay**, selector `disperse(address,address[],uint256[])` (pinned
   `c87b1ae3`), then **decodes the on-chain calldata**
   ([`parseDisperseCall`](../src/lib/tron/disperseCalldata.ts), a pure, unit-tested ABI
   decoder) for `token` / `recipients[]` / `amounts[]`, and asserts `token == USDT`.
3. Every stored field is derived **here**, from authoritative on-chain calldata — **never the
   client**. So a forged or unrelated txid can never inject fake receipts. Recipients are
   salt-hashed ([`hashWalletAddress`](../src/lib/crypto.ts), the shared WALLET_SALT scheme),
   and rows are upserted via
   [`record_disperse_receipts`](../supabase/migrations/0005_affiliate_portal.sql) — idempotent
   on `(txid, recipient_wallet_hash)`, so a re-POST records 0.

> **Not signature-gated, and it doesn't need to be.** Recording re-verifies + decodes on-chain,
> so a caller can at worst re-record a *real* PurserPay disperse (idempotent). It cannot inject
> fakes, and the recipients are already public in that calldata (we store only their hashes).
> A third party could in principle "backfill" real historical disperses this way — harmless
> (it only surfaces a payee's *true* receipts), so we accept it rather than add a wallet prompt
> to the payout flow.

### Reading

[`/api/affiliate/portal`](../src/app/api/affiliate/portal/route.ts) →
[`affiliateReceipts(hash(signer))`](../src/lib/affiliate/receipts.ts) →
[`affiliate_receipts`](../supabase/migrations/0005_affiliate_portal.sql) selects the signer's
rows **newest first**. Keyed **strictly** on the salted hash of the PROVEN signer (never a URL,
never a client-supplied address), so a viewer sees exactly and only the payouts made to the
wallet they just proved they control. **Chain = verification, index = source** — nothing reads
receipts "from the chain" at display time; the per-row Tronscan link
([`txExplorerUrl`](../src/lib/tron/config.ts)) is the *verification*, not the source.

## §3 — Opaque code + the grant-only bounty ledger

- **Code minted on FIRST signature** (Ockham — no pre-population, no orphan codes).
  [`ensureAffiliateAccount(hash)`](../src/lib/affiliate/accounts.ts) REUSES the
  `referral_accounts` opaque code ([`0003`](../supabase/migrations/0003_referrals.sql)) and
  marks the row `is_affiliate = true`. The shared code resolves to the existing `/r/{code}`
  attribution route; the **wallet is never in the link** (only the opaque code).
- **Attribution (C3) is mostly free:** a prospective agency that opens `/r/{affiliateCode}` gets
  the `pp_ref` cookie, and on its first on-chain subscribe `claim_referral_reward` binds
  `referred_by_code` — already wired.
- **C5 — the bounty ledger** ([`affiliate_bounties`](../supabase/migrations/0005_affiliate_portal.sql)).
  Hooked into the existing claim path
  ([`/api/referral/claim`](../src/app/api/referral/claim/route.ts)) **after** attribution:
  [`recordAffiliateBounty(referrerCode, refereeHash)`](../src/lib/affiliate/accounts.ts) inserts
  a ledger row **only if** the referrer code is an *affiliate*-owned code (so an agency→agency
  referral, which already earns a **free month**, never *also* double-pays a bounty) and it
  isn't a self-referral. One row per `(affiliate, referred agency)`, idempotent.

### The earnings figure is a DEBT ACCUMULATOR, not a balance

The bounty is **not** paid on-chain and has **no** on-chain record. `accrued_amount` is a
Supabase figure the **owner settles by hand** at month end, then resets. The portal **displays**
it via [`affiliate_bounty_summary`](../supabase/migrations/0005_affiliate_portal.sql), labelled
**accrued / pending (paid out manually)** — never "received", never a wallet or on-chain amount.
The accrual *engine* (auto-incrementing months) is deliberately **out of scope**.

### GRANT-ONLY (hard rule)

The ledger can only ever **grant**. It is **never** read on the receipts path — the receipts
module ([`receipts.ts`](../src/lib/affiliate/receipts.ts)) and the `affiliate_receipts` RPC
touch only `disperse_receipts`, never the ledger, so a bounty row can **never** gate or deny an
affiliate's access to their own receipts. Enforced structurally by
[`tests/affiliate/grantOnly.test.ts`](../tests/affiliate/grantOnly.test.ts).

## §4 — Schema, RLS, and the shared hashing scheme

[`0005_affiliate_portal.sql`](../supabase/migrations/0005_affiliate_portal.sql) mirrors the
`0002`–`0004` posture exactly: **RLS on with NO policies** (only `service_role` — the route
handlers — bypasses it; the browser can never read these tables), `security invoker` + pinned
`search_path` RPCs, `service_role`-only grants, `notify pgrst`. It applies **cleanly from a
virgin DB** via `npm run db:reset`.

| object | purpose |
| --- | --- |
| `referral_accounts.is_affiliate` (new column) | marks a referral row as a portal affiliate (vs an agency) — gates the bounty write |
| `disperse_receipts` | the dissociated forward-only receipt index: `recipient_wallet_hash` (salted), `payer_wallet`, `amount_base_units`, `txid`, `network`, `block_ts` |
| `affiliate_bounties` | grant-only ledger: `referral_code`, `affiliate_wallet_hash`, `referred_agency_wallet_hash`, `months_paid 0..6`, `accrued_amount`, `status` |
| RPCs | `record_disperse_receipts`, `affiliate_receipts`, `ensure_affiliate_account`, `record_affiliate_bounty`, `affiliate_bounty_summary` |

Every wallet is keyed by the **same** salted SHA-256 hash used by OFAC / free-tier / referral /
challenge ([`src/lib/crypto.ts`](../src/lib/crypto.ts), WALLET_SALT pepper, trim-only,
case-sensitive) — **not a second hashing scheme**.
[`tests/affiliate/hashAlignment.test.ts`](../tests/affiliate/hashAlignment.test.ts) proves the
record-side hash (calldata hex → `41`-prefix → base58 → hash) equals the read-side hash
(connected base58 → hash).

## §5 — The receipt PDF + public verification (Sprint 1B)

1B fills the per-row PDF seam 1A left in the portal. It adds **no new stored data** — it reads
the existing `disperse_receipts` index and renders a document on the fly.

### What the PDF is (and is not)

A **proof of source of funds**: proof that THIS wallet was paid THIS amount THROUGH PurserPay's
disperse contract — the document a payee shows an exchange or bank. It is **not** a tax document,
an invoice, or legal/fiscal advice, and the copy never implies otherwise (the footer says so
explicitly).

### Generation — server-side, signature-gated, never stored

[`POST /api/affiliate/receipt`](../src/app/api/affiliate/receipt/route.ts) (`runtime = "nodejs"`)
is gated **exactly** like the portal read — it REUSES the same `purpose: "portal"` challenge
([`verifyChallenge`](../src/lib/payout/challenge.ts)), not a second gate.

- **A fresh signature authorizes each download.** The 1A challenge nonce is single-use, so a
  download can't silently reuse the portal-open signature. The owner chose **fresh-sign-per-
  download** over minting a session token — faithful to "don't invent a second gate," and the
  right posture for a sensitive file that travels. One wallet prompt per download
  ([`downloadReceiptPdf`](../src/lib/affiliate/receiptClient.ts) → `proveWalletControl(…,
  "portal")`).
- **Every field comes from the index, never the request.** After `verifyChallenge` proves the
  signer, the route looks up [`receiptDetail(txid, hash(signer))`](../src/lib/affiliate/receipts.ts)
  → [`receipt_detail`](../supabase/migrations/0006_receipt_audit.sql). `txid` is only a **selector
  within the signer's own data** (it isn't in the signed bytes and grants no authority); a txid the
  signer was not paid in returns nothing → **404**. So no raw-txid / raw-wallet URL can pull anyone's
  receipt. The PDF's amount / payer / date / network / Audit ID all come from the chain-derived
  index that [`verifyDisperseTx`](../src/lib/tron/serverRead.ts) populated.
- **Recipient wallet is TRUNCATED** on the PDF (`TAbc…wXyz`, from the proven signer) — the owner's
  decision: enough for an exchange to match a wallet it already knows, minimal doxxing on a
  document that leaves the payee's control. The full recipient address is never printed and is not
  stored anywhere (only its salted hash is).
- **Generated on the fly, streamed, NEVER persisted** — no new storage surface, no file retention.
- Built by [`buildReceiptPdf`](../src/lib/affiliate/receiptPdf.ts) with **pdf-lib**
  (zero-runtime-dep PDF writer) + **qrcode-generator** (tiny, zero-dep QR matrix, drawn as vector
  cells). Both are new deps, flagged in the sprint report. Text uses the standard Helvetica font +
  the brand color tokens (aqua/ink/muted/hairline); embedding Inter Tight would need
  `@pdf-lib/fontkit` + a TTF and is a deferred polish.

### The Audit ID (the B5 anchor)

A deterministic, stable identifier — the same receipt always yields the same ID:

```
audit_id = 'PP-' || upper(left(sha256(txid || ':' || recipient_wallet_hash), 16))
```

- **SQL is the single source of truth** — it is a **generated STORED column** on
  `disperse_receipts` ([`0006`](../supabase/migrations/0006_receipt_audit.sql), `extensions.digest`,
  schema-qualified because pgcrypto lives in `extensions`). Generated columns compute for existing
  rows automatically, so the migration applies clean from a virgin DB with no backfill. Production
  never derives the ID; every read returns the column.
- [`auditId()`](../src/lib/affiliate/auditId.ts) is a **Node mirror** kept only for docs/tests —
  [`tests/affiliate/auditId.integration.test.ts`](../tests/affiliate/auditId.integration.test.ts)
  asserts Node ≡ the generated column against real Postgres, so the two can't drift.
- Because `recipient_wallet_hash` is the **salted** hash (WALLET_SALT), the Audit ID is
  **unforgeable** without the pepper and **reveals no wallet**.

### The verification page (anti-Photoshop, D4)

[`/verify/[txid]?a=<auditId>`](../src/app/verify/[txid]/page.tsx) is a **public, read-only** server
component — no wallet, no signature, no cookies. It resolves `(txid, auditId)` via
[`verifyReceipt`](../src/lib/affiliate/verify.ts) →
[`verify_receipt`](../supabase/migrations/0006_receipt_audit.sql) and shows the batch facts + a
Tronscan link.

- **It reads the amount from the INDEX** (chain-derived truth), **never from the URL** — the RPC
  takes only `(txid, auditId)` and has **no amount parameter**. So a payee who opens Inspect
  Element, fakes an amount, and prints is **exposed**: this page shows the real amount, and the
  Tronscan link lets anyone confirm on-chain. A forged/tampered link simply resolves to "couldn't
  verify" (never a false confirmation).
- **It leaks nothing beyond the txid's public on-chain footprint** — `verify_receipt` never returns
  the recipient hash; `txid` is already public and `auditId` is an opaque, non-reversible digest.

Exercised end-to-end (offline-signed challenges + local dev server) in the 1B sprint report:
valid signer → 200 PDF; foreign signer → 403; unpaid txid → 404; another payee → 404;
`/verify` shows the real amount for a good Audit ID and refuses a forged one.

## §6 — The Flex Card (Sprint 1C, viral-loop validation)

A **secondary "Share" button** per receipt row generates a **1200×630 branded image** the payee
posts to Twitter/Telegram — turning the niche's native income-flexing into free distribution. It is
deliberately **cheap** and framed as an **experiment**: the lowest-cost test of whether the viral
loop is real. It reuses everything from 1B (the exact signature gate, the index, the Audit ID,
`/verify`) and adds **no migration and no new stored data**.

### Download model, not a live OG URL

The gate forces it: a card is generated behind the payee's **own signature** (keyed on
`hash(signer)`), so there is **no public `og:image` URL** for a receipt (that would be "reachable by
raw txid/wallet"). The payee **downloads** the PNG and attaches it to their post — exactly like the
1B PDF. [`POST /api/affiliate/flex`](../src/app/api/affiliate/flex/route.ts) (`runtime = "nodejs"`)
mirrors the 1B receipt route: `verifyChallenge(…, "portal")` → `affiliateWalletHash(address)` →
[`receiptDetail(txid, hash)`](../src/lib/affiliate/receipts.ts) (a txid the signer wasn't paid in →
404) → [`ensureAffiliateAccount(hash)`](../src/lib/affiliate/accounts.ts) (the opaque `/r/{code}`) →
render. Generated on the fly; **never stored** (`cache-control: no-store`).

### The mandatory privacy toggle (D1.3) — and the no-wallet guarantee (D3.1)

Before generating, the payee MUST choose how the amount appears. The pure
[`flexModel.ts`](../src/lib/affiliate/flexModel.ts) (`buildFlexModel`) builds the card's text from
ONLY the whole-USDT magnitude, the public txid, the Audit ID, the opaque code, and the origin — it
**never receives a wallet address** (not the recipient/signer, not the paying agency), so the model
*cannot* render one in ANY mode. That is the structural guarantee against leaking an address onto a
public image. Modes:

| mode | headline | notes |
| --- | --- | --- |
| **hidden** (default, safe) | `"{N}-figure payment"` | digit count only; no number. The owner-chosen safe default — a hurried payee who just hits Generate can't leak a targetable figure. |
| **range** | `"+{bucket} USDT"` | largest round threshold ≤ amount (never overstates); degrades to hidden below the smallest bucket. |
| **exact** | `"{amount} USDT"` | plus the Audit ID + a `/verify/{txid}?a={auditId}` reference (badge integrity, below). |

The only on-chain identifier on the card is a **truncated public txid** — never a wallet.
Enforced by [`tests/affiliate/flexModel.test.ts`](../tests/affiliate/flexModel.test.ts) (no
wallet-shaped string in the model, in any mode) and
[`tests/affiliate/flexGate.test.ts`](../tests/affiliate/flexGate.test.ts) (the route feeds no
wallet into the model).

### Capture QR + honest copy + badge integrity (D3.2 / D4.1)

- The QR **always** resolves to `{origin}/r/{code}` (the affiliate's opaque code — **never a
  wallet**); a scanning agency lands on the untouched attribution route.
- Microcopy is **honest**: *"Cobra sin comisiones de intermediario"* — never "sin comisiones" /
  "elimina todas las comisiones" (which reads as a free product and burns the lead at the 150/mo
  paywall).
- **Badge integrity (exact mode):** an exact-amount card prints the **Audit ID + a `/verify`
  reference**, tying the "✓ On-Chain Verified" seal to the 1B verifiable path — so a montaged
  "+900K" card can be caught (the `/verify` page shows the real on-chain amount).

### Brand surface + rendering

Rendered with **`next/og`** (`ImageResponse`/Satori) — no new image library; the QR is an SVG
data-URI `<img>` from the 1B **qrcode-generator**. Warm bone ground, graphite ink, aqua accent,
**Inter Tight** — sober = high status ("Swiss bank receipt"), never dark-mode/terminal-green (D2.1).
Satori can't use the app's woff2 variable font, so a **static Inter Tight woff is vendored**
([`src/lib/affiliate/fonts`](../src/lib/affiliate/fonts), OFL — an asset, not an npm image library),
read via `process.cwd()` and traced into the function by `outputFileTracingIncludes` in
[`next.config.mjs`](../next.config.mjs). The check glyph is an inline SVG (the latin woff subset
omits U+2713).

## Non-custodial is untouched

The portal only **reads** and adds two dissociated tables (1A); 1B adds only an `audit_id` column
and two read RPCs; 1C adds **nothing stored at all** (no migration) — the Flex Card PNG is streamed
and never persisted, and it carries no wallet. None of it signs, holds funds or keys, broadcasts, or
touches the permissionless `disperse` path. The only on-chain call any of it triggers — the
wallet-control signature (portal open AND each PDF/Flex-Card download) — moves no funds and is stated
as such in the message the payee signs. The public `/verify` page reads only what the batch txid
already exposes on-chain.
