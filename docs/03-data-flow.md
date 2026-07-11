# 03 — Data Flow

> **AI disclaimer — read first.** This document is a *map, not the territory*. If
> anything here conflicts with the source, **the source wins**. Cross-check against the
> referenced files before refactoring, and keep this doc in the same change that alters
> the behavior it describes. All paths are repo-relative.

---

## 1. Two tiers of data, two rules

> **We store nothing we can read.**

| Tier | What | Where | Leaves the browser? |
| --- | --- | --- | --- |
| **Roster** | payee names, roles, addresses, amounts; payout receipts | **IndexedDB (Dexie)** — `src/lib/db.ts` | **Never** in readable form. The only thing that leaves is the transaction the user signs. |
| **Account + compliance** | account holder's PII (name, country, tax id); subscription state; OFAC screening data | **Supabase** — `supabase/migrations/0001_compliance_schema.sql` | Yes, but **encrypted** (PII, pgcrypto AES-256) or **salted-hashed** (wallets). Never readable. |

The dividing line is absolute: **the server never receives the roster.** See
[`04-compliance-and-encryption.md`](./04-compliance-and-encryption.md) for the encrypted
tier; this doc covers the roster tier and the payout pipeline.

## 2. The Dexie schema (`src/lib/db.ts`)

DB name `purserpay`. Three stores (v2; v1 was roster-only, upgraded additively so
existing rosters survive):

| Store | Shape (key fields) | Purpose |
| --- | --- | --- |
| `payees` | `id`, `order`, `name`, `role`, `address`, `amount` | The roster. `order` is a `Date.now()` sort key (UUID PKs don't iterate in insertion order). |
| `payments` | `id`, `txid`, `network`, `timestamp`, `payeeIds[]`, `recipients[]`, `totalBaseUnits` | A confirmed on-chain batch = the local receipt behind a green row. |
| `meta` | `key`, `value` | Small KV. Holds `greenSince` — the green-cycle boundary. |

Roster CRUD is in `src/lib/roster.ts`; the CSV overwrite path (`replaceRoster`) is an
**atomic** `clear()` + `bulkAdd()` transaction — if anything fails, the existing roster is
left completely untouched, never half-written. A payee is **never** destroyed just because
the balance won't cover them (Law of UX #2 — see [`05` is the contract; UX laws live in
`CLAUDE.md`]).

## 3. Green = paid (derived, not a flag)

"Paid"/green is **derived from receipts**, not stored on the row. Logic in
`src/lib/receipts.ts`:

- A row is green if a receipt in the **current cycle** on the **current network** lists
  its id (`paidPayeeIds(payments, since)`).
- **Reset** (`advanceGreenCycle`) writes `greenSince = Date.now()` — it does **not** delete
  receipts. Older receipts stay as history but stop greening rows, so next month's payout
  of the same roster can proceed. History (the downloadable report) ignores `since`.
- A receipt on another network never greens a row here (`network` guard), and green
  survives a reload (it's in IndexedDB).

This is what makes accidental **re-payment structurally hard**: a paid row is visibly
green and excluded from `outstanding`/`payable` in the hook.

## 4. The payout pipeline — the 3-gate choke-point

Every payout — "Pay all" or a single row — funnels through **one** function:
`runPayment(rows)` in `src/hooks/usePayout.ts`. It enforces three gates in order. This is
the single most important control-flow in the app.

```mermaid
flowchart TD
    Start([User clicks Pay all / Pay row]) --> G1{Gate 1:<br/>subscriptionActive === true?}
    G1 -->|"anything but true<br/>(unknown / inactive / unreadable)"| Paywall[Open SubscribeDialog<br/>nothing signed] 
    G1 -->|true| G2Start[setScreening true]

    G2Start --> G2["Gate 2: verifyRosterCompliance(addresses)<br/>server action — OFAC"]
    G2 -->|throws / cannot verify| FailClosed[payError set —<br/>NOTHING sent<br/>fail CLOSED]
    G2 -->|"flagged.length > 0"| Block[OfacBlockedDialog<br/>whole batch blocked]
    G2 -->|clean| G3

    G3["Gate 3: runDisperse(operator, rows)"] --> Approve{allowance < total?}
    Approve -->|yes| DoApprove[approve once — user signs]
    Approve -->|no| Batch
    DoApprove --> Batch[disperse each ≤BATCH_CAP chunk<br/>user signs each]
    Batch --> Confirm{receipt = SUCCESS?}
    Confirm -->|yes| Receipt[addReceipt → live query → row turns green]
    Confirm -->|no| Stop[stop at first failure —<br/>confirmed batches are real,<br/>nothing after is 'paid']
```

Gate specifics (all in `usePayout.ts` → `runPayment`, plus `canPayAll`):

- **Gate 1 — subscription (frontend paywall).** `if (subscriptionActive !== true)` → open
  the paywall and **stop**; nothing is signed. **Fail-closed**: unknown / inactive /
  unreadable all route to the paywall. The gate can never silently open. Status is read
  in `src/lib/tron/subscription.ts` (see §6).
- **Gate 2 — OFAC.** `verifyRosterCompliance(rows.map(r => r.address))` (server action).
  A hit blocks the **whole** batch (atomic — never a partial workaround). A thrown error
  **fails closed** — an unverifiable roster must never look clean. Details in
  [`04`](./04-compliance-and-encryption.md).
- **Gate 3 — disperse.** Only reached when subscribed **and** the roster is clean. Runs
  `runDisperse` (§5).

`canPayAll` additionally requires: connected, right network, not already paying/screening,
`payable.length > 0`, `blockedCount === 0`, and `shortfallUnits <= 0n` (balance covers the
selected sum). This is UX Law #2 ("zero fear") made mechanical — the button is locked, and
tells you how much is missing, rather than letting a payout revert.

## 5. The money path (`src/lib/tron/disperse.ts`)

`runDisperse(operator, rows, events, signal)`:

1. Convert every amount to exact base units up front (`toBaseUnits`) — a bad amount fails
   here, before any signature, naming the row.
2. Compute the grand total; split rows into `ceil(N / BATCH_CAP)` chunks (`BATCH_CAP`
   = 100). This is a **signing boundary, never a partial-pay boundary** — each chunk is
   independently atomic.
3. **Approve once** for the grand total, but only if the standing allowance is short
   (fewer signatures = closer to the ≤3-click law).
4. Disperse each chunk with a `feeLimit` sized by `feeLimitForBatch()` (energy-based; see
   `config.ts`). The user's **own** wallet signs each.
5. Poll each tx's receipt (`waitForReceipt`). A batch is reported **confirmed only** once
   its on-chain receipt says `SUCCESS`. **Stop at the first failure** — every already-
   confirmed batch is genuinely on-chain; nothing in or after a failed batch is ever
   reported paid. A half-batch or a "paid" that didn't move money is structurally
   impossible.

Atomicity guarantee: the on-chain `disperse` is all-or-nothing (see
[`05`](./05-smart-contract.md)). The frontend never paints green except on a `SUCCESS`
receipt.

> **Mainnet caveat (flagged in code):** mainnet USDT-TRC20 requires resetting a non-zero
> allowance to 0 before re-approving. The Nile mock does not. See
> [`06-deployment.md`](./06-deployment.md).

## 6. The subscription read (`src/lib/tron/subscription.ts`)

- `getSubscriptionStatus(account)` reads `subscriptionExpiresAt(account)` over the app's
  **keyless read client** (never the injected wallet) — reading via the wallet is what used
  to make the public landing touch TronLink on load. `account` is only the constant-call
  `from`; nothing is signed, no prompt is raised.
- **Fail-closed twice over:** if the contract isn't deployed (`PURSERPAY_ADDRESS ===
  PENDING_DEPLOYMENT_ADDRESS`) it returns `active: false` with no chain call; a read failure
  throws `rpcUnreachable`, and every caller treats a throw as "not subscribed", never active.
- `runSubscribe(operator, plan, …)` approves the plan's price to PurserPay (if the allowance
  is short), then calls `subscribe(planType)` — the user's **own** wallet signs. Plan 0 =
  monthly (150/30d), plan 1 = annual (1,500/365d).

> On-chain reality check: only the flat `subscribe(planType)` path exists. The dashboard
> paywall subscribes on **plan 0** (monthly). The annual tier is selection/display on the
> landing pricing section; there is no separate annual contract method beyond `planType=1`.

### Subscribe order (why payment precedes storage)

In `usePayout.ts` → `subscribe(pii)`: (1) pay on-chain **first** from the user's own
wallet — if it throws, nothing is stored (no orphan PII for a non-subscriber); (2) only on
success, persist the encrypted PII via the server action (**best-effort** — a store
failure must not re-open the dialog, since re-clicking would re-charge: `runSubscribe`
isn't idempotent); (3) re-read the gate → active → close the paywall.

## 7. The ✓ / ✓✓ double-check and its privacy invariant

`src/lib/tron/validation.ts` — the "zero fear" heart of the table, and the most
privacy-sensitive read in the app.

| Level | Meaning | Reads |
| --- | --- | --- |
| `invalid` | fails `tronWeb.isAddress` | **offline**, nothing leaves the device |
| `valid-format` | structurally valid, on-chain status unknown (pre-connect / no indexer) | offline |
| `valid` (✓) | account is **activated** on-chain (real, used address) | via the user's own provider |
| `paid-before` (✓✓) | the **connected wallet** has sent USDT to this exact address within `HISTORY_WINDOW_DAYS` (90) | via the user's own provider |

**THE NON-NEGOTIABLE PRIVACY INVARIANT:** the ✓✓ history read sends exactly **one**
address — the operator's own wallet `W` — to the node, and only to the provider the
user's own wallet already talks to. It asks "what did `W` send?" and matches the returned
payee addresses **locally**. **Payee addresses are never transmitted for ✓✓.** There is no
Purser server, no Purser API key, no Purser-controlled endpoint in this path. If the
provider can't answer (a bare node with no indexer), ✓✓ **degrades** to ✓ / valid-format
— it is *never* replaced by a Purser-side call.

```mermaid
sequenceDiagram
    participant UI as Dashboard (usePayout)
    participant Prov as User's own provider (node)
    participant Local as Local matcher
    UI->>Prov: "transactions where from = W (operator), token = USDT, last 90d"
    Note over UI,Prov: ONLY W is sent. No payee address leaves the device.
    Prov-->>UI: list of {to, type} the operator paid
    UI->>Local: intersect returned `to` with roster addresses
    Local-->>UI: mark matches ✓✓ (paid-before)
    Note over Local: matching happens on-device
```

If you touch this file, preserve the invariant. Adding a Purser API key or sending payee
addresses to any endpoint for verification is a **critical privacy regression**.

## 8. Receipts and reports (`src/lib/receipts.ts`, `src/lib/receiptPdf.ts`)

Purely local, read-only, no chain call, no funds:

- **Per-row receipt** — a `justificante` for one payee: reads the batch that paid them in
  the current cycle, narrows the recipient list to that one person (the tx/date stay the
  batch's — the on-chain proof is the batch tx), prints to PDF with a Tronscan link.
- **Full report** — every paid recipient still in the roster, across every batch on this
  network, newest first, each with its date and Tronscan link. Ignores `since` (survives a
  Reset), but a payee removed from the dashboard drops from the report.

## 9. Deleting local data

`deleteAllData()` clears the entire local DB (roster, payment history, green-cycle meta)
plus session tx/selection state. It is **device-local only** — the account's encrypted PII
in Supabase and the on-chain subscription are untouched (that's the correct boundary: local
wipe ≠ account erasure; GDPR erasure of the PII is a separate server action — see
[`04`](./04-compliance-and-encryption.md)).
