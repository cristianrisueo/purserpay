// lib.js — thin tronweb helpers for the Nile deploy/measure script.
//
// Everything is built on transactionBuilder + sendRawTransaction (rather than the
// high-level contract().new()/method() sugar) for one reason: we need the txid AND
// the on-chain receipt for every single call, to read energy_used / energy_fee /
// energy_penalty_total / result. The sugar hides the deploy txid.
//
// The private key is read from process.env.PRIVATE_KEY (loaded from .env by the
// caller). It is NEVER printed, logged, echoed, or written anywhere. Only the
// derived base58 address (public) is surfaced.

const { TronWeb } = require("tronweb");

const FULL_HOST = "https://nile.trongrid.io";
const NILE_TX = "https://nile.tronscan.org/#/transaction/";
const NILE_ADDR = "https://nile.tronscan.org/#/contract/";

const SUN = 1_000_000; // 1 TRX = 1e6 sun
const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

// A keyless instance, purely for pure utility functions (keccak, account gen).
// In tronweb v6 these live on the INSTANCE (`tw.utils.*`), not the static class.
// Construction makes no network call.
const _u = new TronWeb({ fullHost: FULL_HOST });

// --- setup -----------------------------------------------------------------

function getTronWeb() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk.trim().length === 0) {
    throw new Error(
      "PRIVATE_KEY is not set. Create contracts/scripts/.env with a line " +
        "PRIVATE_KEY=<your funded Nile testnet key> (no 0x prefix). " +
        "The file is gitignored; the key is never printed or committed."
    );
  }
  const tronWeb = new TronWeb({ fullHost: FULL_HOST, privateKey: pk.trim() });
  return tronWeb;
}

// --- receipt polling -------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll getTransactionInfo until the receipt is populated. Returns the full info
// object (info.receipt.{energy_usage_total,energy_fee,energy_penalty_total,result},
// info.contractResult, info.resMessage, info.log).
async function waitForReceipt(tronWeb, txid, { tries = 30, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const info = await tronWeb.trx.getTransactionInfo(txid);
    if (info && Object.keys(info).length > 0 && info.receipt) {
      return info;
    }
    await sleep(delayMs);
  }
  throw new Error(`Receipt for ${txid} did not appear after ${tries} polls`);
}

// Normalize a receipt into the fields we report.
function readEnergy(info) {
  const r = info.receipt || {};
  const result = r.result || (info.result === "FAILED" ? "FAILED" : "SUCCESS");
  return {
    result, // "SUCCESS" | "REVERT" | "OUT_OF_TIME" | "OUT_OF_ENERGY" | "FAILED" | ...
    pass: result === "SUCCESS",
    energyTotal: r.energy_usage_total || 0, // total energy consumed
    energyFromStake: r.energy_usage || 0, // energy paid from frozen stake
    energyFeeSun: r.energy_fee || 0, // TRX (in sun) burned for energy
    energyPenalty: r.energy_penalty_total || 0, // penalty energy (OUT_OF_TIME etc.)
    netUsage: r.net_usage || 0,
  };
}

// --- deploy / send / call --------------------------------------------------

// Deploy a constructor-less contract. Returns { address(base58), txid, energy }.
async function deploy(tronWeb, abi, bytecode, { feeLimit = 3000 * SUN } = {}) {
  const owner = tronWeb.defaultAddress.hex;
  const unsigned = await tronWeb.transactionBuilder.createSmartContract(
    {
      abi,
      bytecode,
      feeLimit,
      callValue: 0,
      userFeePercentage: 100,
      originEnergyLimit: 10_000_000, // TRON max; caller pays 100% so this is a formality
      parameters: [],
    },
    owner
  );
  const signed = await tronWeb.trx.sign(unsigned);
  const sent = await tronWeb.trx.sendRawTransaction(signed);
  if (!sent.result && !sent.txid) {
    throw new Error("Deploy broadcast failed: " + JSON.stringify(sent));
  }
  const txid = unsigned.txID;
  const info = await waitForReceipt(tronWeb, txid);
  const energy = readEnergy(info);
  if (!energy.pass) {
    throw new Error(`Deploy reverted (${energy.result}) txid=${txid}`);
  }
  const address = tronWeb.address.fromHex(info.contract_address);
  return { address, txid, energy, info };
}

// Send a state-changing contract call. Returns { txid, info, energy } and does NOT
// throw on an on-chain revert (callers inspect energy.result) — but DOES throw on a
// broadcast/network failure.
async function send(
  tronWeb,
  contractAddr,
  funcSig,
  params,
  { feeLimit = 1000 * SUN } = {}
) {
  const owner = tronWeb.defaultAddress.hex;
  const built = await tronWeb.transactionBuilder.triggerSmartContract(
    contractAddr,
    funcSig,
    { feeLimit, callValue: 0 },
    params,
    owner
  );
  if (!built.result || !built.result.result) {
    throw new Error(
      `triggerSmartContract build failed for ${funcSig}: ` +
        JSON.stringify(built.result || built)
    );
  }
  const signed = await tronWeb.trx.sign(built.transaction);
  await tronWeb.trx.sendRawTransaction(signed);
  const txid = built.transaction.txID;
  const info = await waitForReceipt(tronWeb, txid);
  return { txid, info, energy: readEnergy(info) };
}

// Read-only call. Returns the raw constant_result[0] hex (no 0x), or null.
async function constCall(tronWeb, contractAddr, funcSig, params) {
  const owner = tronWeb.defaultAddress.base58;
  const res = await tronWeb.transactionBuilder.triggerConstantContract(
    contractAddr,
    funcSig,
    {},
    params,
    owner
  );
  if (!res.result || !res.result.result) {
    throw new Error(
      `constant call failed for ${funcSig}: ` + JSON.stringify(res.result || res)
    );
  }
  return (res.constant_result && res.constant_result[0]) || null;
}

// Convenience: read a uint256 view function of one address arg (balanceOf/etc).
async function readUint(tronWeb, contractAddr, funcSig, params) {
  const hex = await constCall(tronWeb, contractAddr, funcSig, params);
  return hex ? BigInt("0x" + hex) : 0n;
}

// --- fresh recipients ------------------------------------------------------

// Generate N never-funded base58 recipient addresses. Recipients don't sign, so
// they need no TRX; we only ever use the address. Round-trips base58<->hex via
// tronweb so encoding into address[] params is correct.
function freshAddresses(tronWeb, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const acct = tronWeb.utils.accounts.generateAccount();
    out.push(acct.address.base58);
  }
  return out;
}

// --- error / event decoding ------------------------------------------------

const keccak = (s) =>
  _u.utils.ethersUtils.keccak256(_u.utils.ethersUtils.toUtf8Bytes(s));
const selector = (sig) => keccak(sig).slice(0, 10); // 0x + 4 bytes

// Selector -> human name, for our contract's custom errors and the OZ errors the
// atomicity test is expected to surface.
const ERROR_SIGS = [
  "LengthMismatch(uint256,uint256)",
  "EmptyBatch()",
  "ZeroAddressRecipient(uint256)",
  "ZeroAmount(uint256)",
  "ERC20InsufficientAllowance(address,uint256,uint256)",
  "ERC20InsufficientBalance(address,uint256,uint256)",
  "SafeERC20FailedOperation(address)",
  "Error(string)",
  "Panic(uint256)",
];
const SELECTOR_MAP = Object.fromEntries(
  ERROR_SIGS.map((sig) => [selector(sig), sig])
);

// Given the revert data (info.contractResult[0], hex without 0x), name the error.
function decodeError(contractResult) {
  if (!contractResult || contractResult.length < 8) return null;
  const sel = "0x" + contractResult.slice(0, 8);
  return SELECTOR_MAP[sel] || `unknown selector ${sel}`;
}

// Decode a hex resMessage (a plain-string revert reason) into text, if present.
function decodeResMessage(info) {
  if (!info.resMessage) return null;
  try {
    return Buffer.from(info.resMessage, "hex").toString("utf8").replace(/\0+$/, "");
  } catch {
    return info.resMessage;
  }
}

// Find and decode the Dispersed(payer, token, recipientCount, totalAmount) event
// in a receipt's logs. Returns null if not present.
const DISPERSED_TOPIC = keccak(
  "Dispersed(address,address,uint256,uint256)"
).slice(2); // no 0x, to match log topics
function decodeDispersed(tronWeb, info) {
  const logs = info.log || [];
  for (const lg of logs) {
    if (!lg.topics || lg.topics[0] !== DISPERSED_TOPIC) continue;
    const payerHex = "41" + lg.topics[1].slice(24); // last 20 bytes -> TRON addr
    const tokenHex = "41" + lg.topics[2].slice(24);
    const data = lg.data || "";
    return {
      payer: tronWeb.address.fromHex(payerHex),
      token: tronWeb.address.fromHex(tokenHex),
      recipientCount: BigInt("0x" + data.slice(0, 64)),
      totalAmount: BigInt("0x" + data.slice(64, 128)),
    };
  }
  return null;
}

// --- misc ------------------------------------------------------------------

const trxLink = (txid) => NILE_TX + txid;
const addrLink = (addr) => NILE_ADDR + addr;
const sunToTrx = (sun) => Number(sun) / SUN;

module.exports = {
  TronWeb,
  FULL_HOST,
  SUN,
  MAX_UINT256,
  getTronWeb,
  waitForReceipt,
  readEnergy,
  deploy,
  send,
  constCall,
  readUint,
  freshAddresses,
  selector,
  decodeError,
  decodeResMessage,
  decodeDispersed,
  trxLink,
  addrLink,
  sunToTrx,
};
