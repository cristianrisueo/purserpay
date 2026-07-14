// verify-e2e.cjs — READ-ONLY on-chain verification for the E2E suite (env-driven).
//
// Keyless by design: builds its own TronWeb with NO private key and only ever calls
// triggerConstantContract (constant/view reads). It never signs, never broadcasts,
// never moves funds. Safe to run at any time; run it before and after the human test
// steps and diff the printed numbers.
//
// EVERYTHING network-specific is env-driven with NO defaults (fail closed), matching
// deploy.cjs so prod (mainnet) and sandbox (nile) never get crossed:
//   DEPLOY_NETWORK     "nile" | "mainnet"     (picks fullHost + explorer)
//   PURSERPAY_ADDRESS  the deployed contract
//   USDT_ADDRESS       the token
//   TREASURY_WALLET    the treasury to read a balance for
//   VERIFY_WALLET      the tester wallet whose subscription/balance we read
//   VERIFY_RECIPIENTS  OPTIONAL "Name:Taddr,Name:Taddr" test payees to print balances for
// A missing required var aborts before any read.
//
// Usage:
//   DEPLOY_NETWORK=nile PURSERPAY_ADDRESS=… USDT_ADDRESS=… TREASURY_WALLET=… \
//     VERIFY_WALLET=… node scripts/tron/verify-e2e.cjs

const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(ROOT, ".env") });
require("dotenv").config({ path: path.join(ROOT, ".env.local") });

const L = require("./lib.cjs");
const { TronWeb } = L;

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`${name} is required (no default). Set it before running. Aborting.`);
  }
  return String(v).trim();
}

// --- config (env-driven — no defaults) --------------------------------------
const NET = L.resolveNetwork(); // validates DEPLOY_NETWORK (throws on missing/unknown)
const PURSERPAY = requireEnv("PURSERPAY_ADDRESS");
const USDT = requireEnv("USDT_ADDRESS");
const TREASURY = requireEnv("TREASURY_WALLET");
const WALLET2 = requireEnv("VERIFY_WALLET"); // the tester wallet we read
const RECIPIENTS = (process.env.VERIFY_RECIPIENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const idx = pair.indexOf(":");
    return [pair.slice(0, idx), pair.slice(idx + 1)];
  });

// Keyless instance — no privateKey. Constant calls need a `from` address, not a key.
const tw = new TronWeb({ fullHost: NET.fullHost });

async function constCall(contract, funcSig, params, from) {
  const res = await tw.transactionBuilder.triggerConstantContract(
    contract,
    funcSig,
    {},
    params,
    from
  );
  if (!res.result || !res.result.result) {
    throw new Error(
      `constant call failed for ${funcSig}: ${JSON.stringify(res.result || res)}`
    );
  }
  return (res.constant_result && res.constant_result[0]) || null;
}

async function readUint(contract, funcSig, params, from) {
  const hex = await constCall(contract, funcSig, params, from);
  return hex ? BigInt("0x" + hex) : 0n;
}

async function readBool(contract, funcSig, params, from) {
  const hex = await constCall(contract, funcSig, params, from);
  return hex ? BigInt("0x" + hex) !== 0n : false;
}

const addrParam = (a) => [{ type: "address", value: a }];
const usdt = (units) => (Number(units) / 1_000_000).toLocaleString("en-US");

async function main() {
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`E2E — read-only on-chain state (${NET.key})`);
  console.log(`  contract: ${PURSERPAY}`);
  console.log(`  usdt:     ${USDT}`);
  console.log("──────────────────────────────────────────────────────────────");

  // --- subscription (Wallet 2) ---------------------------------------------
  const active = await readBool(
    PURSERPAY,
    "isSubscriptionActive(address)",
    addrParam(WALLET2),
    WALLET2
  );
  const expiresSec = await readUint(
    PURSERPAY,
    "subscriptionExpiresAt(address)",
    addrParam(WALLET2),
    WALLET2
  );
  const expiresMs = Number(expiresSec) * 1000;
  const expiresIso = expiresSec === 0n ? "—" : new Date(expiresMs).toISOString();
  const daysLeft =
    expiresSec === 0n ? "—" : ((expiresMs - Date.now()) / 86_400_000).toFixed(2);

  console.log("\nSUBSCRIPTION (Wallet 2)");
  console.log(`  isSubscriptionActive:   ${active}`);
  console.log(`  subscriptionExpiresAt:  ${expiresSec} (${expiresIso})`);
  console.log(`  days remaining:         ${daysLeft}`);

  // --- USDT balances -------------------------------------------------------
  console.log("\nUSDT BALANCES (6-dp)");
  const rows = [
    ["Wallet 2 (tester)", WALLET2],
    ["Treasury (Wallet 1)", TREASURY],
    ...RECIPIENTS.map(([n, a]) => [n, a]),
  ];
  for (const [label, addr] of rows) {
    const bal = await readUint(USDT, "balanceOf(address)", addrParam(addr), WALLET2);
    console.log(`  ${label.padEnd(20)} ${usdt(bal).padStart(12)} USDT   ${addr}`);
  }

  console.log("\nExpected deltas (guidance — diff a before/after run):");
  console.log("  TC2 monthly subscribe: Wallet2 -150, Treasury +150, active=true, ~30d");
  console.log("  TC4 disperse 2,500:    Wallet2 -2,500, Luna +500, Marco +1,000, Priya +1,000");
  console.log("  TC5 annual subscribe:  Wallet2 -1,500, Treasury +1,500, expiry ~365d from now");
}

main().catch((e) => {
  console.error("verify-e2e failed:", e.message);
  process.exit(1);
});
