// Minimal ABIs + the error-selector table for the two contracts we talk to.
//
// Committed here (not imported from scripts/tron/, whose measurements.json is
// gitignored). Only the surface the frontend actually calls is included, plus the
// forward-looking PurserPay surface (subscribe + reads) so the ABI is complete.
//
// Why a hand-written selector table at all: a reverted TRON tx surfaces only a
// generic "REVERT opcode executed" in Tronscan and in simulated calls — the
// decodable 4-byte custom-error selector lives in the mined tx's
// receipt.contractResult. So the frontend decodes it itself to show a calm,
// human message instead of a raw revert. The four disperse guards were verified
// live on Nile (they match scripts/tron/errors.json) and are unchanged in PurserPay;
// the two OZ ERC20 ones are keccak-derived and confirmed.

// A permissive local ABI shape. tronweb's own ABI types live behind fragile
// deep import paths; we keep our own minimal type and cast at the single
// tronWeb.contract() boundary in client.ts instead of coupling to internals.
export type AbiFragment = {
  type: string
  name?: string
  stateMutability?: string
  inputs?: ReadonlyArray<{ name?: string; type: string; indexed?: boolean }>
  outputs?: ReadonlyArray<{ name?: string; type: string }>
  anonymous?: boolean
}

/**
 * PurserPay — the ownerless disperse + subscribe contract (successor to
 * PurseDisperseUsdt). The `disperse` signature, the `Dispersed` event, and the
 * four disperse-guard error selectors are byte-identical to the old contract, so
 * the positional call in disperse.ts and the decoding in errors.ts keep working.
 * The `subscribe`/read surface is included for the on-chain subscription gate; the
 * frontend does not call it yet. The export name `DISPERSE_ABI` is kept because
 * disperse.ts binds it — new code should prefer the `PURSERPAY_ABI` alias below.
 */
export const DISPERSE_ABI: AbiFragment[] = [
  // --- disperse: signature preserved (disperse.ts calls it positionally) ---
  {
    type: "function",
    name: "disperse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Dispersed",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "recipientCount", type: "uint256", indexed: false },
      { name: "totalAmount", type: "uint256", indexed: false },
    ],
  },
  // --- subscribe: multi-tier (plan 0 = 250/30d, plan 1 = 2,500/365d) ---
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [{ name: "planType", type: "uint8" }],
    outputs: [],
  },
  {
    type: "event",
    name: "SubscriptionPaid",
    inputs: [
      { name: "subscriber", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
      { name: "expirationTime", type: "uint256", indexed: false },
    ],
  },
  // --- read-only surface (subscription state, immutables, constants) ---
  { type: "function", name: "isSubscriptionActive", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "subscriptionExpiresAt", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "treasuryWallet", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "usdt", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "SUBSCRIPTION_PRICE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "SUBSCRIPTION_PERIOD", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "SUBSCRIPTION_PRICE_ANNUAL", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "SUBSCRIPTION_PERIOD_ANNUAL", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // --- custom errors: first four preserved from PurseDisperseUsdt (identical selectors) ---
  { type: "error", name: "LengthMismatch", inputs: [{ name: "recipientsLength", type: "uint256" }, { name: "amountsLength", type: "uint256" }] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "ZeroAddressRecipient", inputs: [{ name: "index", type: "uint256" }] },
  { type: "error", name: "ZeroAmount", inputs: [{ name: "index", type: "uint256" }] },
  // --- new PurserPay errors ---
  { type: "error", name: "TransferFailed", inputs: [{ name: "token", type: "address" }, { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }] },
  { type: "error", name: "ZeroAddressConfig", inputs: [] },
  { type: "error", name: "InvalidPlan", inputs: [{ name: "planType", type: "uint8" }] },
]

/** Preferred alias for the full contract ABI. Points at the same array as
 *  `DISPERSE_ABI`, which is retained only because disperse.ts imports that name. */
export const PURSERPAY_ABI = DISPERSE_ABI

/** ERC20 (USDT-TRC20) — the reads + the one write (approve) we need. */
export const ERC20_ABI: AbiFragment[] = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
]

/** topic0 of the Dispersed event (keccak of its signature), for log matching.
 *  Verified live on Nile and re-confirmed identical for PurserPay. Stored without
 *  the 0x prefix — that's how TRON event logs report topics. */
export const DISPERSED_TOPIC0 =
  "51339121778590fc38fef2c25cb944290642db23218edbb55ceb5923e14bbd40"

/** topic0 of the SubscriptionPaid event, for the future gate's log matching.
 *  keccak-derived from PurserPay; not yet observed on-chain. No 0x prefix. */
export const SUBSCRIPTION_PAID_TOPIC0 =
  "4bca87c7e6f9908c8c137d8f4f07efc731f97eaecbb20a4a9c1fcd24a3787436"

/** 4-byte revert selector → how to name it for a human. `indexHint` marks the
 *  per-index guards whose first arg is the offending recipient row. */
export type ErrorSpec = {
  name: string
  /** true when the error's first uint256 arg is the failing recipient index. */
  indexHint: boolean
}

export const ERROR_SELECTORS: Record<string, ErrorSpec> = {
  // PurserPay / PurseDisperseUsdt custom guards (verified live on Nile; unchanged)
  "0xab8b67c6": { name: "LengthMismatch", indexHint: false },
  "0xc2e5347d": { name: "EmptyBatch", indexHint: false },
  "0x0ae5f8db": { name: "ZeroAddressRecipient", indexHint: true },
  "0x9af70448": { name: "ZeroAmount", indexHint: true },
  // PurserPay transfer-failure + config + plan guards (keccak-derived from PurserPay.sol;
  // not yet mined on-chain — the contract is not deployed in this sprint)
  "0xcd3f1659": { name: "TransferFailed", indexHint: false },
  "0x0948465e": { name: "ZeroAddressConfig", indexHint: false },
  "0xcc0a45bc": { name: "InvalidPlan", indexHint: false },
  // OpenZeppelin ERC20 (surfaced through a failed transferFrom on the Nile mock)
  "0xfb8f41b2": { name: "ERC20InsufficientAllowance", indexHint: false },
  "0xe450d38c": { name: "ERC20InsufficientBalance", indexHint: false },
}
