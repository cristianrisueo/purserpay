// verify-e2e.cjs — READ-ONLY on-chain verification for the PHASE 2 E2E suite.
//
// Keyless by design: builds its own TronWeb with NO private key and only ever calls
// triggerConstantContract (constant/view reads). It never signs, never broadcasts,
// never moves funds. Safe to run at any time; run it before and after the human test
// steps and diff the printed numbers.
//
// Reads:
//   PurserPay (TCmB…):  isSubscriptionActive(Wallet2), subscriptionExpiresAt(Wallet2)
//   Mock USDT (TSYr…):  balanceOf(Wallet2, Luna, Marco, Priya, treasury)
//
// Usage:  node scripts/tron/verify-e2e.cjs

const { TronWeb } = require("tronweb");

const FULL_HOST = "https://nile.trongrid.io";

// --- addresses (the PHASE 2 test vector) -----------------------------------
const PURSERPAY = "TXkQ55A9XE28A8gF8FxNgSTTQREiiMxurG";
const USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const WALLET2 = "THfX1kFnhmPzA3dezaXy7EpXMaLYrJnEzi"; // tester
const TREASURY = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"; // Wallet 1 / treasury
const RECIPIENTS = [
  ["Luna", "TXRq2AHYDM7XEqiTbGxJWXaoStGattVPBi"],
  ["Marco", "TKtoPDoDxfA3VHLWZ16xgbNRsnTa27LJMY"],
  ["Priya", "TVA4rWscxng3AwibKg6rytPSBwc7iA9v6N"],
];

// Keyless instance — no privateKey. Constant calls need a `from` address, not a key.
const tw = new TronWeb({ fullHost: FULL_HOST });

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
  console.log("PHASE 2 E2E — read-only on-chain state (Nile)");
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
