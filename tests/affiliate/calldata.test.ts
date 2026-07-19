// Unit tests for the PURE disperse-calldata decoder. No network, no DB, no wallet.
// tronweb's own ABI encoder is used as an INDEPENDENT oracle: we encode a disperse
// call with it, then assert parseDisperseCall recovers exactly what went in — and that
// every malformed/hostile input decodes to null (so a non-disperse tx records nothing).
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { TronWeb } from "tronweb"

import {
  DISPERSE_SELECTOR,
  parseDisperseCall,
} from "../../src/lib/tron/disperseCalldata.ts"

const tw = new TronWeb({ fullHost: "https://nile.trongrid.io" })

const DISPERSE_ABI = {
  name: "disperse",
  inputs: [
    { name: "token", type: "address" },
    { name: "recipients", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
  ],
}

const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf" // Nile USDT
const REC_A = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"
const REC_B = "TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC"

/** 20-byte lowercase hex (no 0x, no 41 prefix) — the ABI address form the decoder returns. */
function hex20(addr: string): string {
  return tw.address.toHex(addr).replace(/^0x/, "").toLowerCase().slice(2)
}

/** Build full disperse calldata (selector + ABI args) with tronweb's own encoder. */
function encodeDisperse(
  token: string,
  recipients: string[],
  amounts: string[]
): string {
  const args = tw.utils.abi
    .encodeParamsV2ByABI(DISPERSE_ABI, [token, recipients, amounts])
    .replace(/^0x/, "")
  return DISPERSE_SELECTOR + args
}

test("decodes a 2-recipient disperse round-trip (token, recipients, amounts)", () => {
  const data = encodeDisperse(TOKEN, [REC_A, REC_B], ["1000000", "2500000"])
  const parsed = parseDisperseCall(data)
  assert.ok(parsed, "should decode")
  assert.equal(parsed.tokenHex20, hex20(TOKEN))
  assert.deepEqual(parsed.recipientsHex20, [hex20(REC_A), hex20(REC_B)])
  assert.deepEqual(parsed.amounts, ["1000000", "2500000"])
})

test("decoded recipient hex reconstructs the original base58 (hash-alignment basis)", () => {
  const data = encodeDisperse(TOKEN, [REC_A], ["1000000"])
  const parsed = parseDisperseCall(data)
  assert.ok(parsed)
  // The recording path 41-prefixes the decoded 20-byte hex to rebuild the base58 form.
  const rebuilt = tw.address.fromHex("41" + parsed.recipientsHex20[0])
  assert.equal(rebuilt, REC_A)
})

test("accepts a 0x-prefixed data string too", () => {
  const data = "0x" + encodeDisperse(TOKEN, [REC_A], ["7"])
  const parsed = parseDisperseCall(data)
  assert.ok(parsed)
  assert.deepEqual(parsed.amounts, ["7"])
})

test("rejects the wrong selector (a subscribe call, not a disperse)", () => {
  const args = tw.utils.abi
    .encodeParamsV2ByABI(DISPERSE_ABI, [TOKEN, [REC_A], ["1"]])
    .replace(/^0x/, "")
  assert.equal(parseDisperseCall("49c7e639" + args), null)
})

test("rejects a recipients/amounts length mismatch (2 recipients, 1 amount)", () => {
  const data = encodeDisperse(TOKEN, [REC_A, REC_B], ["1000000"])
  assert.equal(parseDisperseCall(data), null)
})

test("rejects truncated calldata", () => {
  const data = encodeDisperse(TOKEN, [REC_A, REC_B], ["1", "2"])
  // Chop the tail so the amounts array runs past the end.
  assert.equal(parseDisperseCall(data.slice(0, data.length - 64)), null)
})

test("rejects empty / non-hex / selector-only input", () => {
  assert.equal(parseDisperseCall(""), null)
  assert.equal(parseDisperseCall("0xnothex"), null)
  assert.equal(parseDisperseCall(DISPERSE_SELECTOR), null) // selector but no args
  // @ts-expect-error — a non-string must not throw, just return null.
  assert.equal(parseDisperseCall(null), null)
})

test("the pinned selector matches tronweb's keccak of the signature", () => {
  const sel = tw.sha3("disperse(address,address[],uint256[])", false).slice(0, 8)
  assert.equal(sel, DISPERSE_SELECTOR)
})
