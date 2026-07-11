# 02 — The Non-Custodial Principle (the moat)

> **AI disclaimer — read first.** This document is a *map, not the territory*. If
> anything here conflicts with the source, **the source wins**. Cross-check against the
> referenced files before refactoring, and keep this doc in the same change that alters
> the behavior it describes. All paths are repo-relative.

---

## THE ONE INVIOLABLE PRINCIPLE

**Non-custodial, always. No exceptions, ever.**

- Purser **NEVER** holds funds. **NEVER** holds keys. **NEVER** broadcasts a transaction.
- The app builds an unsigned batch; the client's **own** wallet signs and sends it.
- This is simultaneously the **legal moat** (arm's-length, no money-transmitter license)
  and the **sales pitch**. Any code, copy, or feature that breaks it is wrong by
  definition.

Everything else in this repo is negotiable. This is not. If a task appears to require
holding funds/keys, broadcasting for the user, storing the roster server-side, or storing
readable PII — **STOP and flag the owner** (see `CLAUDE.md`).

## Why it matters (say it in one breath)

Because Purser is arm's-length — it only *compiles* a transaction the user signs
themselves — it is not a money transmitter and needs no MSB/VASP license. The moment it
touches funds, keys, or broadcast, that legal posture collapses. The guarantee is also
the pitch to a de-banked agency: *"we literally cannot run off with your money."*

## Where each guarantee is enforced in code

This is the important part for a future agent: the principle is not a slogan, it is
enforced at specific, verifiable points. Do not weaken any of them.

| Guarantee | Enforced in | How |
| --- | --- | --- |
| Purser never signs | `src/lib/tron/client.ts` | Two TronWeb instances kept apart: a **keyless** `readClient()` (no signer, reads only) and `getInjectedTronWeb()` (TronLink's, already the user's account). **All** writes use the injected one. |
| Purser never broadcasts | `src/lib/tron/disperse.ts`, `subscription.ts` | Every `.send()` is called on a contract bound to the **injected** wallet — TronLink signs and propagates. There is no server-side signer anywhere in the repo. |
| Purser never holds funds (on-chain) | `contracts/src/PurserPay.sol` | `disperse`/`subscribe` move value **directly** payer→recipient / subscriber→treasury via `transferFrom`. The contract's own token balance is **invariably zero** — proven by a Foundry stateful invariant. |
| No withdraw / upgrade / custody escape | `contracts/src/PurserPay.sol` | No `withdraw`, no proxy/upgrade path, no `payable`/`receive`/`fallback`. Immutable `usdt` + `treasuryWallet`. |
| Free path is permissionless | `contracts/src/PurserPay.sol` → `disperse()` | No owner gate, no fee, no subscription check on-chain. Anyone can call it; the subscription is a **frontend** business gate, not an on-chain one. |
| Roster never leaves the device | `src/lib/db.ts`, `src/hooks/usePayout.ts` | The roster lives in IndexedDB (Dexie) only. No server call ever carries it. See [`03`](./03-data-flow.md). |
| ✓✓ history read stays private | `src/lib/tron/validation.ts` | Only the operator's **own** wallet address is sent to the node (the user's own provider); payee addresses are matched **locally**. |

### The two-instance rule (the transport-level guarantee)

`src/lib/tron/client.ts` is the single most load-bearing file for this principle:

```
readClient()            → keyless, app-owned TronWeb on the public node.
                          Used ONLY for offline utilities (isAddress, base58↔hex)
                          and last-resort public reads. NEVER signs.
getInjectedTronWeb()    → TronLink's injected TronWeb, already on the USER's account
                          and the USER's chosen node. ALL signing + operator-tied
                          reads go here.
```

If you ever find a `.send()` or an `approve`/`disperse`/`subscribe` write routed through
`readClient()` or any server-side key, that is a **critical regression** — it breaks
non-custodial. There is intentionally no private key in the web app's env (`PRIVATE_KEY`
exists only for the gitignored deploy script, `scripts/tron/deploy.cjs`, run by the owner
locally — never in the running app).

## The single qualification: owner-adjustable subscription fees

There is exactly **one** owner-privileged on-chain action, and it is a **pricing lever,
not custody**:

- `updateSubscriptionFees(uint256 newMonthly, uint256 newAnnual)` — sets the two
  subscription prices. Plus `transferOwnership(address)` to hand off that role.
- The owner **can never**: touch funds, hold custody, access keys, broadcast on a user's
  behalf, pause/halt/reverse anything, or alter the permissionless `disperse` path.

So the accurate phrasing (used in the public FAQ and `CLAUDE.md`) is:

- **Non-custodial:** fully intact — unaffected by the owner role.
- **"Ownerless / no admin keys":** *qualified* — the contract holds no admin keys **over
  your money**; the sole owner power is repricing the flat subscription fee.

Do **not** revert to an absolute "no admin keys" claim in copy — it is inaccurate now.
Details and the full governance rationale are in [`05-smart-contract.md`](./05-smart-contract.md).

## What the server is allowed to do (and only this)

Purser runs a backend for **exactly four** reasons — none of which is custody:

1. Hide API keys / the OFAC feed (server-side secrets).
2. Screen recipients against OFAC before a batch (server-side).
3. Gate the on-chain subscription (a read + a frontend paywall).
4. Store the **account holder's own** PII, encrypted at rest.

It still never touches funds, keys, broadcast, or the roster. See
[`04-compliance-and-encryption.md`](./04-compliance-and-encryption.md).

## Red-flag checklist for any future change

Reject or flag any change that would:

- [ ] introduce a server-side signer / private key in the running app;
- [ ] route a `.send()` through anything but the injected wallet;
- [ ] add a `withdraw`, `pause`, upgrade/proxy, or `receive`/`fallback` to the contract;
- [ ] add a fee or owner gate to `disperse()`;
- [ ] send the roster (names/addresses/amounts) to any server in readable form;
- [ ] persist recipient addresses in the clear, or store readable PII;
- [ ] claim "no admin keys" without the fee-only qualification.
