// Pure ABI decoder for the PurserPay `disperse` calldata — NO env, NO secret, NO
// tronweb, NO server-only import, so it is trivially unit-testable (node --test) and
// safe to load anywhere. serverRead.ts wires it into verifyDisperseTx (which adds the
// on-chain read + tronweb address conversion).
//
// WHY WE DECODE THE CALLDATA AT ALL: the affiliate portal shows a payee their
// disperse-anchored receipts (docs/09). The on-chain Dispersed(payer, token, count,
// total) event has NO per-recipient data, and the roster is device-local — so the ONLY
// authoritative, forgery-proof source of "who was paid what" is the disperse tx's OWN
// input calldata. The client posts only a public txid; the server decodes this and
// stores what the chain says, never what the client claims. Chain = source of truth.
//
// The decoded surface is `disperse(address token, address[] recipients,
// uint256[] amounts)` — standard Solidity ABI over the args after the 4-byte selector:
//   word0: token         (address, left-padded to 32 bytes)
//   word1: offset to recipients[]   (dynamic tail)
//   word2: offset to amounts[]      (dynamic tail)
// Each dynamic array is [length, elem0, elem1, …], one 32-byte word per element.
// Addresses are the low 20 bytes of their word; on TRON the base58 form is that
// 20-byte hex with a `41` prefix (added by the caller, not here).

/** keccak256("disperse(address,address[],uint256[])")[:4], no 0x. Verified against
 *  tronweb's sha3 (and cross-checked: the same method reproduces the known
 *  subscribe(uint8) selector 49c7e639). Pinned like SUBSCRIBE_SELECTOR. */
export const DISPERSE_SELECTOR = "c87b1ae3"

/** A malformed/hostile calldata could claim an enormous array length; cap the element
 *  count far above any real batch (BATCH_CAP=100) so decoding a crafted length fails
 *  fast instead of allocating unbounded work. */
const MAX_ELEMENTS = 100_000

export type DisperseCall = {
  /** token address as low-20-byte lowercase hex (no 0x, no 41 prefix). */
  tokenHex20: string
  /** recipient addresses, each low-20-byte lowercase hex (no 0x, no 41 prefix). */
  recipientsHex20: string[]
  /** amounts as decimal strings (uint256 base units), positionally paired with recipients. */
  amounts: string[]
}

/**
 * Decode PurserPay disperse calldata (selector + ABI args) into token / recipients /
 * amounts. Returns null on ANY structural problem — wrong/short selector, truncated
 * data, mismatched recipient/amount counts, or an out-of-range/crafted length — so the
 * caller treats an undecodable tx as "not a disperse" and stores nothing.
 *
 * Pure string math on the hex; no dependency, no allocation beyond the outputs.
 */
export function parseDisperseCall(dataHex: string): DisperseCall | null {
  if (typeof dataHex !== "string") return null
  let hex = dataHex.trim().toLowerCase()
  if (hex.startsWith("0x")) hex = hex.slice(2)
  if (!/^[0-9a-f]*$/.test(hex) || hex.length < 8) return null

  if (hex.slice(0, 8) !== DISPERSE_SELECTOR) return null
  const args = hex.slice(8)

  // Read the 32-byte (64-hex) word at word index `i`; null if it runs past the end.
  const wordAt = (i: number): string | null => {
    const start = i * 64
    if (start + 64 > args.length) return null
    return args.slice(start, start + 64)
  }
  const toBig = (w: string): bigint => BigInt("0x" + w)
  const addrOf = (w: string): string => w.slice(24) // low 20 bytes = last 40 hex chars

  const w0 = wordAt(0)
  const w1 = wordAt(1)
  const w2 = wordAt(2)
  if (w0 === null || w1 === null || w2 === null) return null

  const tokenHex20 = addrOf(w0)

  // Read a dynamic array (address or uint256) at a byte offset into `args`. Returns the
  // raw element words, or null on truncation / an implausible length.
  const readArrayWords = (offsetBytes: number): string[] | null => {
    if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0) return null
    const base = offsetBytes * 2 // hex chars
    if (base + 64 > args.length) return null
    const len = Number(toBig(args.slice(base, base + 64)))
    if (!Number.isSafeInteger(len) || len < 0 || len > MAX_ELEMENTS) return null
    const out: string[] = []
    for (let i = 0; i < len; i++) {
      const s = base + 64 + i * 64
      if (s + 64 > args.length) return null
      out.push(args.slice(s, s + 64))
    }
    return out
  }

  const recWords = readArrayWords(Number(toBig(w1)))
  const amtWords = readArrayWords(Number(toBig(w2)))
  if (recWords === null || amtWords === null) return null
  if (recWords.length !== amtWords.length) return null

  return {
    tokenHex20,
    recipientsHex20: recWords.map(addrOf),
    amounts: amtWords.map((w) => toBig(w).toString()),
  }
}
