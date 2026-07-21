// approve.cjs — set a USDT allowance from the deployer wallet to a spender (env-driven).
//
// Single purpose: grant PurserPay a small standing USDT allowance so the read-only energy
// measurement (measure-nile.cjs / measure-mainnet.cjs) can run — a constant-call disperse()
// still executes the REAL transferFrom, which reverts on a zero allowance. Also usable before
// the S-4 mainnet measurement (identical shape, DEPLOY_NETWORK=mainnet).
//
// SAFE BY DEFAULT, mirroring deploy.cjs: a bare run prints a PREFLIGHT PLAN and broadcasts
// NOTHING; the approve only fires with CONFIRM_APPROVE=1, after the owner reviews the plan.
// PRIVATE_KEY is read from the gitignored .env (via lib.cjs) and is NEVER printed or logged.
//
// USDT-safe reset: real USDT-TRC20 rejects changing a NON-ZERO allowance directly — you must set
// it to 0 first. If a different non-zero allowance already stands, this resets to 0 then approves
// (two broadcasts). If the standing allowance already covers the target, it is a no-op.
//
// Env (all required unless noted; no defaults → fail closed):
//   DEPLOY_NETWORK    "nile" | "mainnet"
//   USDT_ADDRESS      the USDT-TRC20 token (MUST match the app's USDT_ADDRESS for the network)
//   SPENDER           the contract to approve (the deployed PurserPay)
//   EXPECTED_DEPLOYER the signer must equal this, or abort
//   APPROVE_AMOUNT    optional; USDT base units (6dp). Default 1_000_000 = 1 USDT.
//
// Usage:
//   DEPLOY_NETWORK=nile USDT_ADDRESS=… SPENDER=… EXPECTED_DEPLOYER=… \
//     node scripts/tron/approve.cjs                      # dry preflight (no broadcast)
//   … CONFIRM_APPROVE=1 node scripts/tron/approve.cjs    # broadcast the approve

const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(ROOT, ".env") });
require("dotenv").config({ path: path.join(ROOT, ".env.local") });

const L = require("./lib.cjs");

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`${name} is required (no default). Set it before running. Aborting.`);
  }
  return String(v).trim();
}

const NET = L.resolveNetwork();
const USDT = requireEnv("USDT_ADDRESS");
const SPENDER = requireEnv("SPENDER");
const EXPECTED_DEPLOYER = requireEnv("EXPECTED_DEPLOYER");
const AMOUNT = BigInt(process.env.APPROVE_AMOUNT || "1000000"); // default 1 USDT (6dp)

const addrParam = (a) => [{ type: "address", value: a }];

async function main() {
  const confirm = process.env.CONFIRM_APPROVE === "1";
  const tronWeb = L.getTronWeb(); // throws a clear message if PRIVATE_KEY is unset
  const signer = tronWeb.defaultAddress.base58;

  const allowance = await L.readUint(tronWeb, USDT, "allowance(address,address)", [
    { type: "address", value: signer },
    { type: "address", value: SPENDER },
  ]);

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`USDT approve → TRON ${NET.key} — preflight`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  network:            ${NET.key} (${NET.fullHost})`);
  console.log(`  usdt:               ${USDT}`);
  console.log(`  signer (owner):     ${signer}`);
  console.log(`  spender (PurserPay):${SPENDER}`);
  console.log(`  current allowance:  ${allowance} base units (${(Number(allowance) / 1e6).toLocaleString("en-US")} USDT)`);
  console.log(`  target allowance:   ${AMOUNT} base units (${(Number(AMOUNT) / 1e6).toLocaleString("en-US")} USDT)`);
  console.log("──────────────────────────────────────────────────────────────");

  if (signer !== EXPECTED_DEPLOYER) {
    throw new Error(
      `Signer mismatch: PRIVATE_KEY resolves to ${signer}, expected ${EXPECTED_DEPLOYER}. ` +
        `Aborting — nothing was broadcast.`
    );
  }

  if (allowance >= AMOUNT) {
    console.log(`\n✓ Standing allowance already covers the target (${allowance} ≥ ${AMOUNT}). No-op — nothing to do.`);
    return;
  }

  const needsReset = allowance > 0n; // USDT rejects a direct non-zero→non-zero change
  console.log(
    needsReset
      ? "\nPLAN: reset allowance to 0 (USDT requires it), THEN approve the target amount (2 txs)."
      : "\nPLAN: approve the target amount (1 tx)."
  );

  if (!confirm) {
    console.log(
      "\nDRY PREFLIGHT — nothing was broadcast. Review the plan above, then re-run with:\n" +
        "  CONFIRM_APPROVE=1 node scripts/tron/approve.cjs\n"
    );
    return;
  }

  console.log("\nCONFIRM_APPROVE=1 — broadcasting…");
  if (needsReset) {
    console.log("  → approve(spender, 0) …");
    const r0 = await L.send(tronWeb, USDT, "approve(address,uint256)", [
      { type: "address", value: SPENDER },
      { type: "uint256", value: "0" },
    ]);
    console.log(`    ${r0.energy.result}  tx ${L.trxLink(r0.txid)}`);
    if (!r0.energy.pass) throw new Error(`reset approve failed (${r0.energy.result})`);
  }
  console.log(`  → approve(spender, ${AMOUNT}) …`);
  const r = await L.send(tronWeb, USDT, "approve(address,uint256)", [
    { type: "address", value: SPENDER },
    { type: "uint256", value: AMOUNT.toString() },
  ]);
  console.log(`    ${r.energy.result}  tx ${L.trxLink(r.txid)}`);
  if (!r.energy.pass) throw new Error(`approve failed (${r.energy.result})`);

  const after = await L.readUint(tronWeb, USDT, "allowance(address,address)", [
    { type: "address", value: signer },
    { type: "address", value: SPENDER },
  ]);
  console.log(`\n✓ APPROVED. allowance now ${after} base units (${(Number(after) / 1e6).toLocaleString("en-US")} USDT).`);
  console.log(`  Next: re-run the measurement — PURSERPAY_ADDRESS=${SPENDER} MEASURE_WALLET=${signer} node scripts/tron/measure-nile.cjs`);
}

main().catch((e) => {
  console.error("\napprove failed:", e.message);
  process.exit(1);
});
