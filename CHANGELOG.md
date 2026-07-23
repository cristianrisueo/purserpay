# Changelog

All notable changes to PurserPay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-07-14

First public release. **PurserPay is live on TRON mainnet** — a non-custodial, no-KYC USDT
payout tool: it reads a team, validates every address, computes splits, and has the operator's
own wallet sign one batch transaction. Purser never touches funds, keys, or transaction
propagation.

### Added

- **Non-custodial batch-payout contract (`PurserPay.sol`).** `disperse()` moves USDT straight
  from the payer to each recipient via `transferFrom` — permissionless, immutable, no fee, and
  the contract's own token balance is invariably zero. Proven by **30/30 Foundry tests**,
  including a stateful invariant that the contract **never holds USDT**, verified across
  **128,000 fuzzed calls** with zero reverts. The only owner-privileged surface is monetization
  (subscription fees + the treasury destination) — it can never touch funds, keys, broadcast,
  pause, or `disperse`.
- **On-chain subscription.** 150 USDT/month or 1,500 USDT/year, paid on-chain to the contract —
  no fiat, no card. Owner-adjustable fees and treasury (no redeploy, no proxy); `usdt` immutable.
- **OFAC / sanctions screening.** Recipient addresses are screened server-side against the SDN
  list before a batch can be built or signed; a hit blocks the whole batch. Screening keys and
  the feed stay server-side; persisted addresses are salted-SHA-256 hashed.
- **Free tier.** One payee per payer wallet per 30 days, forever — enforced off-chain in the
  authorize gate with **TOCTOU-safe atomic consumption** (and a refund path that re-verifies the
  txid on-chain before restoring a slot).
- **Wallet-control challenge.** A single-use signature challenge (TIP-191 `signMessageV2`) with a
  CSPRNG nonce, recovered and verified server-side **before** any quota or credit is touched — so
  a spoofed public address can't burn a customer's free slot. Salted nonce hash, 5-minute TTL.
  (This is wallet-control proof, not an auth session.)
- **Asymmetric referral loop.** Off-chain credit: a paying customer banks one free month when an
  invitee pays their first month on-chain; the invitee gets no discount. Reward fixed at a **1:1
  ratio** (reward value never exceeds the referee's cost — self-referral is zero-margin).
  Behind a **kill switch, off by default**; the contract is untouched (the chain stays the source
  of truth for payments).
- **Non-zero-allowance reset for mainnet USDT.** Mainnet USDT-TRC20's `approve()` reverts unless
  the standing allowance is 0 — so `ensureAllowance` clears a non-zero, insufficient allowance to
  0 (confirmed by receipt) before re-approving, and announces the extra prompt calmly. Wired into
  both the disperse and subscribe paths.
- **Build-time network seam.** `NEXT_PUBLIC_TRON_NETWORK` selects the whole chain block (network +
  contract + USDT) at build time and **throws** on a missing/unrecognized value (fail closed).
  Client and server resolve the same constant, so they can never target different networks; there
  is no runtime toggle. Non-mainnet builds render a persistent SANDBOX banner (dead-code-eliminated
  from the mainnet bundle).
- **Device-local roster.** The team roster (names, addresses, amounts) lives only in the browser
  (IndexedDB/Dexie) and never reaches a server in readable form. Account-holder PII is encrypted
  at rest (pgcrypto AES-256); the free-tier and referral rows are salted-hashed, no-PII.
- **Atomic batches, no false green.** A batch confirms whole or reverts whole; a row turns green
  only on a `SUCCESS` on-chain receipt. If the balance won't cover the selected total, the button
  locks and says how much is missing — never a silent partial payout.

### Deployment

- **Mainnet contract:** `TH6TVSJb7VG6fYjSGyHrHUhghJ1gg4PqXm` (TRON mainnet, **S-1 GUARDED** build,
  S-4 2026-07-23) — supersedes the deprecated pre-guard `TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha`.
- **Deploy tx:** `8572f2896637ae36ca0b0827b1644def5ded30f641c9c2ee1fdf75101d03c316` (668,613 energy,
  **0 TRX for energy** via delegation + ~5.25 TRX bandwidth).
- **Token:** mainnet Tether USD-TRC20 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (verified as the
  contract's `usdt` immutable on-chain).
- **Energy constants (⚠ pending re-measurement against the guarded contract):**
  `ENERGY_PER_RECIPIENT_FRESH = 157,000`, `ENERGY_BASE = 3,100`, calibrated by constant-call
  simulation against the **pre-guard** live contract (linear fit, 0.0% residual). Nile's testnet mock
  USDT was **not** representative — a **3.9× miss** (Nile read ~40,000/recipient) that would have
  killed a real payroll to fresh wallets with `OUT_OF_ENERGY`. `feeLimit` at the 100-recipient batch
  cap ≈ 2,355 TRX (under the 15,000 TRX max). The guarded contract adds a per-row blacklist read, so
  these must be **re-measured on mainnet before any real customer batch** (open blocker — see
  `sprint_report.txt`).

[1.0.0]: https://github.com/cristianrisueo/purserpay/releases/tag/v1.0.0
