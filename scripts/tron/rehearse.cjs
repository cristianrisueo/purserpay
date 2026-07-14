// rehearse.cjs — Nile dress-rehearsal helpers for the new bytecode.
//
// Three subcommands, all against the LIVE deployed contract, all signed by the owner key
// (the only key these scripts hold). Env-driven, NO defaults (fail closed). PRIVATE_KEY is
// read from a gitignored .env (dotenv) and NEVER printed. Dry by default: a bare run prints
// the plan and broadcasts nothing; pass CONFIRM=1 to broadcast.
//
//   --topup <addr>       Transfer test USDT + TRX from the treasury (owner) to <addr> so a
//                        TronLink wallet can drive the real subscribe/disperse UI.
//                        Amounts: TOPUP_USDT (whole, default 2000) + TOPUP_TRX (default 200).
//
//   --allowance-reset    Owner-key proof of the exact tx sequence ensureAllowance emits:
//                        approve(150) -> approve(0) -> approve(1500) -> subscribe(1),
//                        asserting each receipt is SUCCESS and the subscription is granted.
//                        (Nile's USDT does NOT enforce allowance==0||value==0, so approve(0)
//                        isn't strictly required here — we run it anyway to prove the reset
//                        call itself works on-chain. The mainnet REVERT protection is proven
//                        by the Foundry/unit tests, not by Nile — see docs/06 §6.)
//
//   --disperse <n>       approve + disperse() to <n> fresh recipients (1 USDT each) against
//                        the real contract; prints exact energy consumed + a copy-pasteable
//                        ENERGY note. This is the empirical calibration docs/06 §6 calls for.
//
// Shared env:
//   DEPLOY_NETWORK "nile"|"mainnet"   PURSERPAY_ADDRESS   USDT_ADDRESS
//
// Usage:
//   DEPLOY_NETWORK=nile PURSERPAY_ADDRESS=… USDT_ADDRESS=… node scripts/tron/rehearse.cjs --allowance-reset
//   … CONFIRM=1 node scripts/tron/rehearse.cjs --disperse 3
//   … TOPUP_USDT=2000 CONFIRM=1 node scripts/tron/rehearse.cjs --topup TYourNileWallet…

const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(ROOT, ".env") });
require("dotenv").config({ path: path.join(ROOT, ".env.local") });

const L = require("./lib.cjs");

const UNIT = 1_000_000n; // 6-dp USDT base units
const usdtUnits = (whole) => (BigInt(whole) * UNIT).toString();
const fmtUsdt = (units) => (Number(units) / 1e6).toLocaleString("en-US");
const FEE = 150 * L.SUN; // approve/subscribe/transfer are cheap; disperse sized separately.

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`${name} is required (no default). Set it before running. Aborting.`);
  }
  return String(v).trim();
}

const confirm = () => process.env.CONFIRM === "1";

/** Broadcast a state-changing call, wait for the receipt, throw unless SUCCESS. */
async function must(tronWeb, addr, sig, params, label, feeLimit = FEE) {
  const res = await L.send(tronWeb, addr, sig, params, { feeLimit });
  const ok = res.energy.result === "SUCCESS";
  console.log(
    `  ${label.padEnd(22)} ${ok ? "✓" : "✗ " + res.energy.result}  ` +
      `energy=${res.energy.energyTotal}  ${L.trxLink(res.txid)}`
  );
  if (!ok) throw new Error(`${label} did not succeed: ${res.energy.result} (txid ${res.txid})`);
  return res;
}

// --- --topup ----------------------------------------------------------------
async function topup(tronWeb, PURSERPAY, USDT, to) {
  const usdtWhole = process.env.TOPUP_USDT || "2000";
  const trxWhole = Number(process.env.TOPUP_TRX || "200");
  const from = tronWeb.defaultAddress.base58;

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`--topup — send test funds to a TronLink wallet`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  from (treasury/owner): ${from}`);
  console.log(`  to:                    ${to}`);
  console.log(`  USDT:                  ${usdtWhole} (${USDT})`);
  console.log(`  TRX:                   ${trxWhole}`);
  console.log("──────────────────────────────────────────────────────────────");
  if (!confirm()) {
    console.log("\nDRY — nothing broadcast. Re-run with CONFIRM=1.\n");
    return;
  }
  await must(
    tronWeb,
    USDT,
    "transfer(address,uint256)",
    [{ type: "address", value: to }, { type: "uint256", value: usdtUnits(usdtWhole) }],
    `USDT transfer`
  );
  // TRX transfer (system contract) — build, sign, broadcast, confirm.
  const unsigned = await tronWeb.transactionBuilder.sendTrx(to, trxWhole * L.SUN, from);
  const signed = await tronWeb.trx.sign(unsigned);
  await tronWeb.trx.sendRawTransaction(signed);
  await L.waitForReceipt(tronWeb, unsigned.txID);
  console.log(`  TRX transfer          ✓  ${L.trxLink(unsigned.txID)}`);
  const bal = await L.readUint(tronWeb, USDT, "balanceOf(address)", [{ type: "address", value: to }]);
  console.log(`\n  ${to} now holds ${fmtUsdt(bal)} USDT (+ ${trxWhole} TRX). Ready for TronLink.`);
}

// --- --allowance-reset ------------------------------------------------------
async function allowanceReset(tronWeb, PURSERPAY, USDT) {
  const me = tronWeb.defaultAddress.base58;
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`--allowance-reset — owner-key proof of the ensureAllowance sequence`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  signer:   ${me}`);
  console.log(`  contract: ${PURSERPAY}`);
  console.log(`  sequence: approve(150) -> approve(0) -> approve(1500) -> subscribe(1)`);
  console.log("──────────────────────────────────────────────────────────────");
  if (!confirm()) {
    console.log("\nDRY — nothing broadcast. Re-run with CONFIRM=1.\n");
    return;
  }
  const spender = { type: "address", value: PURSERPAY };
  console.log();
  await must(tronWeb, USDT, "approve(address,uint256)", [spender, { type: "uint256", value: usdtUnits(150) }], "approve(150)");
  await must(tronWeb, USDT, "approve(address,uint256)", [spender, { type: "uint256", value: "0" }], "approve(0) [reset]");
  await must(tronWeb, USDT, "approve(address,uint256)", [spender, { type: "uint256", value: usdtUnits(1500) }], "approve(1500)");
  await must(tronWeb, PURSERPAY, "subscribe(uint8)", [{ type: "uint8", value: 1 }], "subscribe(1) annual");

  const activeHex = await L.constCall(tronWeb, PURSERPAY, "isSubscriptionActive(address)", [{ type: "address", value: me }]);
  const active = activeHex ? BigInt("0x" + activeHex) !== 0n : false;
  const expHex = await L.constCall(tronWeb, PURSERPAY, "subscriptionExpiresAt(address)", [{ type: "address", value: me }]);
  const exp = expHex ? Number(BigInt("0x" + expHex)) : 0;
  console.log(`\n  isSubscriptionActive(${me}) = ${active} ${active ? "✓" : "✗"}`);
  console.log(`  expires: ${exp ? new Date(exp * 1000).toISOString() : "—"}`);
  if (!active) throw new Error("subscribe(1) did not grant an active subscription.");
  console.log("\n✓ The full on-chain approve-reset-approve-subscribe sequence succeeds on the");
  console.log("  live contract. (Nile can't prove the mainnet revert — that's the unit tests.)");
}

// --- --disperse <n> ---------------------------------------------------------
async function disperseMeasure(tronWeb, PURSERPAY, USDT, n) {
  const me = tronWeb.defaultAddress.base58;
  const recips = L.freshAddresses(tronWeb, n);
  const amounts = recips.map(() => UNIT.toString()); // 1 USDT each
  const total = usdtUnits(n);

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`--disperse ${n} — real-contract energy capture`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  signer:      ${me}`);
  console.log(`  contract:    ${PURSERPAY}`);
  console.log(`  recipients:  ${n} fresh (never-funded → worst-case energy), 1 USDT each`);
  console.log("──────────────────────────────────────────────────────────────");
  if (!confirm()) {
    console.log("\nDRY — nothing broadcast. Re-run with CONFIRM=1.\n");
    return;
  }
  console.log();
  await must(
    tronWeb,
    USDT,
    "approve(address,uint256)",
    [{ type: "address", value: PURSERPAY }, { type: "uint256", value: total }],
    "approve(total)"
  );
  const res = await must(
    tronWeb,
    PURSERPAY,
    "disperse(address,address[],uint256[])",
    [
      { type: "address", value: USDT },
      { type: "address[]", value: recips },
      { type: "uint256[]", value: amounts },
    ],
    `disperse(${n})`,
    1_000 * L.SUN
  );
  const energyTotal = res.energy.energyTotal;
  const perRecip = Math.round(energyTotal / n);
  console.log(`\n  energy total: ${energyTotal}   per-recipient (fresh): ~${perRecip}`);
  console.log(`  TRX burned:   ${L.sunToTrx(res.energy.energyFeeSun)} TRX`);
  console.log("\n  --- NILE datapoint (do NOT paste into config as mainnet values) ---");
  console.log(`  # ${n} fresh recipients: energyTotal=${energyTotal}, ~${perRecip}/recipient`);
  console.log(`  # feeLimitForBatch sizing input; recalibrate on MAINNET (docs/06 §6).`);
}

async function main() {
  const NET = L.resolveNetwork();
  const PURSERPAY = requireEnv("PURSERPAY_ADDRESS");
  const USDT = requireEnv("USDT_ADDRESS");
  const tronWeb = L.getTronWeb();

  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === "--topup") {
    const to = argv[1];
    if (!to) throw new Error("--topup requires a destination address: --topup <TAddr>");
    await topup(tronWeb, PURSERPAY, USDT, to);
  } else if (cmd === "--allowance-reset") {
    await allowanceReset(tronWeb, PURSERPAY, USDT);
  } else if (cmd === "--disperse") {
    const n = parseInt(argv[1] || "3", 10);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("--disperse <n>, 1..20");
    await disperseMeasure(tronWeb, PURSERPAY, USDT, n);
  } else {
    throw new Error("Unknown command. Use --topup <addr> | --allowance-reset | --disperse <n>");
  }
}

main().catch((e) => {
  console.error("\nrehearse failed:", e.message);
  process.exit(1);
});
