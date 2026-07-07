// Minimal ABIs + the error-selector table for the two contracts we talk to.
//
// Committed here (not imported from contracts/scripts, whose measurements.json
// is gitignored). Only the surface the frontend actually calls is included.
//
// Why a hand-written selector table at all: a reverted TRON tx surfaces only a
// generic "REVERT opcode executed" in Tronscan and in simulated calls — the
// decodable 4-byte custom-error selector lives in the mined tx's
// receipt.contractResult. So the frontend decodes it itself to show a calm,
// human message instead of a raw revert. Selectors below were verified live on
// Nile (the four custom ones match contracts/scripts/errors.json; the two OZ
// ERC20 ones are keccak-derived and confirmed).

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

/** PurseDisperseUsdt — just the one function, the event, and its guards. */
export const DISPERSE_ABI: AbiFragment[] = [
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
  { type: "error", name: "LengthMismatch", inputs: [{ name: "recipientsLength", type: "uint256" }, { name: "amountsLength", type: "uint256" }] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "ZeroAddressRecipient", inputs: [{ name: "index", type: "uint256" }] },
  { type: "error", name: "ZeroAmount", inputs: [{ name: "index", type: "uint256" }] },
]

/** ERC20 (USDT-TRC20) — the reads + the one write (approve) we need. */
export const ERC20_ABI: AbiFragment[] = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
]

/** topic0 of the Dispersed event (keccak of its signature), for log matching.
 *  Verified live on Nile. Stored without the 0x prefix — that's how TRON event
 *  logs report topics. */
export const DISPERSED_TOPIC0 =
  "51339121778590fc38fef2c25cb944290642db23218edbb55ceb5923e14bbd40"

/** 4-byte revert selector → how to name it for a human. `indexHint` marks the
 *  per-index guards whose first arg is the offending recipient row. */
export type ErrorSpec = {
  name: string
  /** true when the error's first uint256 arg is the failing recipient index. */
  indexHint: boolean
}

export const ERROR_SELECTORS: Record<string, ErrorSpec> = {
  // PurseDisperseUsdt custom guards (verified live on Nile)
  "0xab8b67c6": { name: "LengthMismatch", indexHint: false },
  "0xc2e5347d": { name: "EmptyBatch", indexHint: false },
  "0x0ae5f8db": { name: "ZeroAddressRecipient", indexHint: true },
  "0x9af70448": { name: "ZeroAmount", indexHint: true },
  // OpenZeppelin ERC20 (surfaced through SafeERC20 on a failed transferFrom)
  "0xfb8f41b2": { name: "ERC20InsufficientAllowance", indexHint: false },
  "0xe450d38c": { name: "ERC20InsufficientBalance", indexHint: false },
}
