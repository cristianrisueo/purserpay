// deploy.cjs — deploy the unified PurserPay contract to the TRON Nile testnet.
//
// We deploy the EXACT bytecode Foundry already produced and tested: the artifact
// at contracts/out/PurserPay.sol/PurserPay.json, compiled solc 0.8.20 /
// optimizer-200 / evmVersion=istanbul (no PUSH0 — TVM-safe) — the same bytecode
// that passed `forge test` 20/20. No re-compile here; forge is the source of truth
// for the bytecode. (The legacy solc-js compile.cjs targets the old, now-deleted
// PurseDisperseUsdt/MockUsdtTrc20 sources and is not used.)
//
// PurserPay's constructor takes two immutable args — (address _usdt, address
// _treasuryWallet) — set once, forever. They are passed as tronweb {type,value}
// parameters through lib.deploy().
//
// Safety: the private key is read from process.env.PRIVATE_KEY (loaded from a
// gitignored .env by dotenv). It is NEVER printed, logged, or written. A bare run
// prints a PREFLIGHT PLAN and broadcasts NOTHING; the deploy only fires when
// re-run with CONFIRM_DEPLOY=1, after the owner has approved the printed plan.
//
// Usage:
//   node scripts/tron/deploy.cjs                 # dry preflight (no broadcast)
//   CONFIRM_DEPLOY=1 node scripts/tron/deploy.cjs # broadcast the deploy

const fs = require("fs");
const path = require("path");

// Load .env (primary) then .env.local (fallback) from the repo root. dotenv does
// not override already-set vars, so .env wins if both define PRIVATE_KEY.
const ROOT = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(ROOT, ".env") });
require("dotenv").config({ path: path.join(ROOT, ".env.local") });

const L = require("./lib.cjs");

// --- deploy configuration (owner-locked) -----------------------------------
// Both constructor args are immutable in the contract — chosen once, forever.
const USDT_ADDRESS = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // Nile USDT (Tether USD, 6dp) — corrected token
const TREASURY_WALLET = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"; // Wallet 1 (deployer)
const EXPECTED_DEPLOYER = "TESXcRcFMU2LwroehawwC2B3HgMYe3XSZ2"; // Wallet 1 must be the signer

const ARTIFACT = path.join(ROOT, "contracts/out/PurserPay.sol/PurserPay.json");
const DEPLOY_FEE = 1_500 * L.SUN; // 1,500 TRX ceiling; actual burn ~150–300 TRX (userFeePercentage 100)

function loadArtifact() {
  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(
      `Foundry artifact not found at ${ARTIFACT}. Run \`cd contracts && forge build\` first.`
    );
  }
  const a = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const abi = a.abi;
  let bytecode = (a.bytecode && a.bytecode.object) || "";
  if (!bytecode) throw new Error("Artifact has no creation bytecode.");
  if (!bytecode.startsWith("0x")) bytecode = "0x" + bytecode;
  const bytes = (bytecode.length - 2) / 2;
  return { abi, bytecode, bytes };
}

// Decode an address returned by a constant call (right-aligned 32-byte word) into
// a base58 TRON address. Uses the live instance's decoder (matches lib.cjs).
function addrFromWord(tronWeb, hexWord) {
  if (!hexWord) return null;
  const clean = hexWord.replace(/^0x/, "");
  return tronWeb.address.fromHex("41" + clean.slice(-40));
}

async function main() {
  const confirm = process.env.CONFIRM_DEPLOY === "1";
  const { abi, bytecode, bytes } = loadArtifact();

  // getTronWeb() throws a clear message if PRIVATE_KEY is unset.
  const tronWeb = L.getTronWeb();
  const deployer = tronWeb.defaultAddress.base58;
  const balSun = await tronWeb.trx.getBalance(deployer);
  const balTrx = L.sunToTrx(balSun);

  console.log("──────────────────────────────────────────────────────────────");
  console.log("PurserPay → TRON Nile testnet — deploy preflight");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  network:        nile (${L.FULL_HOST})`);
  console.log(`  artifact:       contracts/out/PurserPay.sol/PurserPay.json`);
  console.log(`  bytecode:       ${bytes} bytes (istanbul / optimizer-200 / solc 0.8.20)`);
  console.log(`  deployer:       ${deployer}`);
  console.log(`  deployer TRX:   ${balTrx} TRX`);
  console.log(`  constructor _usdt:           ${USDT_ADDRESS}`);
  console.log(`  constructor _treasuryWallet: ${TREASURY_WALLET}`);
  console.log(`  feeLimit ceiling:            ${L.sunToTrx(DEPLOY_FEE)} TRX (userFeePercentage 100)`);
  console.log("──────────────────────────────────────────────────────────────");

  if (deployer !== EXPECTED_DEPLOYER) {
    throw new Error(
      `Signer mismatch: PRIVATE_KEY resolves to ${deployer}, expected ${EXPECTED_DEPLOYER} ` +
        `(Wallet 1). Aborting — nothing was broadcast.`
    );
  }
  if (balTrx < 400) {
    console.warn(
      `  ⚠ deployer balance is ${balTrx} TRX — a deploy can burn ~150–300 TRX. ` +
        `Top up via the Nile faucet (nileex.io) if this is too low.`
    );
  }

  if (!confirm) {
    console.log(
      "\nDRY PREFLIGHT — nothing was broadcast. Review the plan above, then re-run with:\n" +
        "  CONFIRM_DEPLOY=1 node scripts/tron/deploy.cjs\n"
    );
    return;
  }

  // --- broadcast ------------------------------------------------------------
  console.log("\nCONFIRM_DEPLOY=1 — broadcasting the deploy…");
  // tronweb v6 createSmartContract reads each parameter as a RAW value and takes
  // the type from the ABI constructor — pass plain base58 addresses (NOT the
  // {type,value} shape that triggerSmartContract uses).
  const { address, txid, energy } = await L.deploy(tronWeb, abi, bytecode, {
    feeLimit: DEPLOY_FEE,
    parameters: [USDT_ADDRESS, TREASURY_WALLET],
  });

  console.log("\n✓ DEPLOYED");
  console.log(`  contract address (base58): ${address}`);
  console.log(`  deploy txid:               ${txid}`);
  console.log(`  result:                    ${energy.result}`);
  console.log(`  energy used:               ${energy.energyTotal}`);
  console.log(`  TRX burned (energy fee):   ${L.sunToTrx(energy.energyFeeSun)} TRX`);
  console.log(`  tx:       ${L.trxLink(txid)}`);
  console.log(`  contract: ${L.addrLink(address)}`);

  // --- sanity: read back the immutables -------------------------------------
  console.log("\nVerifying immutables on-chain…");
  const usdtHex = await L.constCall(tronWeb, address, "usdt()", []);
  const treasuryHex = await L.constCall(tronWeb, address, "treasuryWallet()", []);
  const priceMonthly = await L.readUint(tronWeb, address, "SUBSCRIPTION_PRICE()", []);
  const priceAnnual = await L.readUint(tronWeb, address, "SUBSCRIPTION_PRICE_ANNUAL()", []);
  const usdtBack = addrFromWord(tronWeb, usdtHex);
  const treasuryBack = addrFromWord(tronWeb, treasuryHex);

  console.log(`  usdt():                 ${usdtBack} ${usdtBack === USDT_ADDRESS ? "✓" : "✗ MISMATCH"}`);
  console.log(
    `  treasuryWallet():       ${treasuryBack} ${treasuryBack === TREASURY_WALLET ? "✓" : "✗ MISMATCH"}`
  );
  console.log(`  SUBSCRIPTION_PRICE():        ${priceMonthly.toString()} ${priceMonthly === 250_000_000n ? "✓ (250e6)" : "✗"}`);
  console.log(`  SUBSCRIPTION_PRICE_ANNUAL(): ${priceAnnual.toString()} ${priceAnnual === 2_500_000_000n ? "✓ (2500e6)" : "✗"}`);

  console.log("\nNext: set PURSERPAY_ADDRESS and DISPERSE_ADDRESS in src/lib/tron/config.ts to:");
  console.log(`  ${address}`);
}

main().catch((e) => {
  console.error("\nDeploy failed:", e.message);
  process.exit(1);
});
