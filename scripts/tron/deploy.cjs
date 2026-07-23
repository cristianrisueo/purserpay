// deploy.cjs — deploy the unified PurserPay contract to a TRON network (env-driven).
//
// We deploy the EXACT bytecode Foundry already produced and tested: the artifact
// at contracts/out/PurserPay.sol/PurserPay.json, compiled solc 0.8.20 /
// optimizer-200 / evmVersion=istanbul (no PUSH0 — TVM-safe). No re-compile here;
// forge is the source of truth for the bytecode. (The legacy solc-js compile.cjs
// targets the old, now-deleted PurseDisperseUsdt/MockUsdtTrc20 sources and is dead.)
//
// PurserPay's constructor takes (address _usdt, address _treasuryWallet). `_usdt` is
// immutable (forever). `_treasuryWallet` is the INITIAL treasury — now owner-updatable
// storage (updateTreasuryWallet), not an immutable, so it can move to cold/multisig
// later WITHOUT a redeploy. Both are passed as tronweb {type,value} params via lib.deploy().
//
// EVERYTHING network-specific is env-driven with NO defaults (fail closed):
//   DEPLOY_NETWORK    "nile" | "mainnet"     (picks fullHost + explorer)
//   USDT_ADDRESS      constructor _usdt      (MUST equal the frontend's USDT_ADDRESS)
//   TREASURY_WALLET   constructor _treasuryWallet (initial treasury)
//   EXPECTED_DEPLOYER the signer must equal this, or abort
//   MIN_TRX_FLOOR     abort if signer liquid TRX is below this (default 100)
// A missing required var aborts before anything is built or broadcast.
//
// Safety: PRIVATE_KEY is read from a gitignored .env (dotenv). It is NEVER printed,
// logged, or written. A bare run prints a PREFLIGHT PLAN and broadcasts NOTHING; the
// deploy only fires when re-run with CONFIRM_DEPLOY=1, after the owner approves the plan.
//
// Usage:
//   DEPLOY_NETWORK=nile USDT_ADDRESS=… TREASURY_WALLET=… EXPECTED_DEPLOYER=… \
//     node scripts/tron/deploy.cjs                  # dry preflight (no broadcast)
//   … CONFIRM_DEPLOY=1 node scripts/tron/deploy.cjs # broadcast the deploy

const fs = require("fs");
const path = require("path");

// Load .env (primary) then .env.local (fallback) from the repo root. dotenv does
// not override already-set vars, so .env wins if both define PRIVATE_KEY.
const ROOT = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(ROOT, ".env") });
require("dotenv").config({ path: path.join(ROOT, ".env.local") });

const L = require("./lib.cjs");

// --- deploy configuration (env-driven — NO defaults, fail closed) ----------
function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(
      `${name} is required (no default). Set it in the environment before deploying — ` +
        `see the header comment for the full var list. Aborting; nothing was built.`
    );
  }
  return String(v).trim();
}

const NET = L.resolveNetwork(); // validates DEPLOY_NETWORK (throws on missing/unknown)
const USDT_ADDRESS = requireEnv("USDT_ADDRESS"); // constructor _usdt (immutable, forever)
const TREASURY_WALLET = requireEnv("TREASURY_WALLET"); // constructor _treasuryWallet (initial; owner-updatable)
const EXPECTED_DEPLOYER = requireEnv("EXPECTED_DEPLOYER"); // signer must equal this
// Abort if the signer's liquid TRX is below this floor. A failed deploy burns the TRX
// it consumed AND yields no contract, so we refuse to start under-funded. Default 80 TRX:
// above the real deploy cost (~61 TRX = 58.05 for energy + ~3 bandwidth, measured on the
// Nile deploy of THIS bytecode), below the owner's mainnet balance (~99.5 TRX). It is a
// FLOOR, not a budget — override with MIN_TRX_FLOOR if energy prices rise (getEnergyFee).
const MIN_TRX_FLOOR = Number(process.env.MIN_TRX_FLOOR || "80");

const ARTIFACT = path.join(ROOT, "contracts/out/PurserPay.sol/PurserPay.json");
// feeLimit sets the tx's TOTAL energy CEILING, not just a TRX-burn cap. TRON limits a contract tx
// to feeLimit / energyFee energy (energyFee = 100 sun on mainnet), so feeLimit MUST be
// >= requiredEnergy * energyFee or the tx reverts OUT_OF_ENERGY at that cap — EVEN IF the wallet
// holds plenty of delegated/rented energy. Delegated energy only makes execution CHEAP (energy
// drawn from it burns ~0 TRX); it does NOT raise this ceiling. So do NOT lower feeLimit to "save
// TRX" when energy is rented: a low feeLimit does not reduce TRX burn (delegation already covers
// it) — it just caps total energy and kills the deploy. (FEE_LIMIT_TRX=4 → a 40,000-energy cap
// caused OUT_OF_ENERGY on 2026-07-23, vs the ~668,613 energy this deploy needs.) The 1,500 TRX
// default is a safe ceiling BECAUSE delegated energy covers real consumption, so the TRX actually
// burned for energy is ~0 regardless of how high the ceiling is. Override only UPWARD if ever needed.
const DEPLOY_FEE = Number(process.env.FEE_LIMIT_TRX || "1500") * L.SUN;

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
  console.log(`PurserPay → TRON ${NET.key} — deploy preflight`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  network:        ${NET.key} (${NET.fullHost})`);
  console.log(`  artifact:       contracts/out/PurserPay.sol/PurserPay.json`);
  console.log(`  bytecode:       ${bytes} bytes (istanbul / optimizer-200 / solc 0.8.20)`);
  console.log(`  deployer:       ${deployer}`);
  console.log(`  deployer TRX:   ${balTrx} TRX`);
  console.log(`  constructor _usdt:           ${USDT_ADDRESS}`);
  console.log(`  constructor _treasuryWallet: ${TREASURY_WALLET}`);
  console.log(`  feeLimit ceiling:            ${L.sunToTrx(DEPLOY_FEE)} TRX (userFeePercentage 100)`);
  console.log(`  min TRX floor:               ${MIN_TRX_FLOOR} TRX`);
  console.log(
    `  est. cost:                   668,613 energy (measured on the 2026-07-23 mainnet deploy of ` +
      `THIS guarded bytecode). With delegated/rented energy covering it, ~0 TRX is burned for ` +
      `energy — the real cost is bandwidth only (~5.25 TRX). Without delegation it would be ` +
      `~66.9 TRX (668,613 × 100 sun) + bandwidth. NOTE: feeLimit must be ≥ 668,613 × getEnergyFee ` +
      `(≥ ~67 TRX ceiling) or the tx reverts OUT_OF_ENERGY — the ceiling is on TOTAL energy, not TRX burn`
  );
  console.log("──────────────────────────────────────────────────────────────");

  if (deployer !== EXPECTED_DEPLOYER) {
    throw new Error(
      `Signer mismatch: PRIVATE_KEY resolves to ${deployer}, expected ${EXPECTED_DEPLOYER}. ` +
        `Aborting — nothing was broadcast.`
    );
  }

  // LOUD WARNING (not an abort): on mainnet, deploying with the treasury == the hot
  // deployer key is a CONSCIOUS, ACCEPTED launch decision — updateTreasuryWallet exists
  // precisely so the treasury can move to cold/multisig later without a redeploy. Printed
  // BEFORE the balance gate so the operator always reads it.
  if (NET.key === "mainnet" && TREASURY_WALLET === EXPECTED_DEPLOYER) {
    console.warn("");
    console.warn("  ⚠⚠⚠ ────────────────────────────────────────────────────────────");
    console.warn("  ⚠⚠⚠  MAINNET: TREASURY_WALLET == EXPECTED_DEPLOYER (the HOT key).");
    console.warn("  ⚠⚠⚠  Your revenue treasury is the same hot key you are deploying with.");
    console.warn("  ⚠⚠⚠  This is acceptable ONLY as a conscious launch decision. Move it to");
    console.warn("  ⚠⚠⚠  a cold/multisig wallet via updateTreasuryWallet once there is traction");
    console.warn("  ⚠⚠⚠  (no redeploy needed — that is exactly why treasury is now updatable).");
    console.warn("  ⚠⚠⚠ ────────────────────────────────────────────────────────────");
    console.warn("");
  }

  // Balance floor: ABORT (not just warn) below the floor. Running out mid-deploy burns
  // the consumed TRX AND yields no contract — the worst outcome.
  if (balTrx < MIN_TRX_FLOOR) {
    throw new Error(
      `Deployer balance ${balTrx} TRX is below the ${MIN_TRX_FLOOR} TRX floor (MIN_TRX_FLOOR). ` +
        `A failed deploy burns the TRX it consumed and produces no contract. Top up first, ` +
        `then re-run. Aborting — nothing was broadcast.`
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

  // --- sanity: read back the on-chain configuration -------------------------
  // usdt() is immutable; treasuryWallet() is now owner-updatable storage — both are
  // still read back to confirm the constructor set them as intended.
  console.log("\nVerifying on-chain configuration…");
  const usdtHex = await L.constCall(tronWeb, address, "usdt()", []);
  const treasuryHex = await L.constCall(tronWeb, address, "treasuryWallet()", []);
  const ownerHex = await L.constCall(tronWeb, address, "owner()", []);
  const priceMonthly = await L.readUint(tronWeb, address, "SUBSCRIPTION_PRICE()", []);
  const priceAnnual = await L.readUint(tronWeb, address, "SUBSCRIPTION_PRICE_ANNUAL()", []);
  const usdtBack = addrFromWord(tronWeb, usdtHex);
  const treasuryBack = addrFromWord(tronWeb, treasuryHex);
  const ownerBack = addrFromWord(tronWeb, ownerHex);

  console.log(`  usdt():                 ${usdtBack} ${usdtBack === USDT_ADDRESS ? "✓" : "✗ MISMATCH"}`);
  console.log(
    `  treasuryWallet():       ${treasuryBack} ${treasuryBack === TREASURY_WALLET ? "✓" : "✗ MISMATCH"}`
  );
  console.log(
    `  owner():                ${ownerBack} ${ownerBack === EXPECTED_DEPLOYER ? "✓ (deployer)" : "✗ MISMATCH"}`
  );
  console.log(`  SUBSCRIPTION_PRICE():        ${priceMonthly.toString()} ${priceMonthly === 150_000_000n ? "✓ (150e6)" : "✗"}`);
  console.log(`  SUBSCRIPTION_PRICE_ANNUAL(): ${priceAnnual.toString()} ${priceAnnual === 1_500_000_000n ? "✓ (1500e6)" : "✗"}`);

  console.log(
    `\nNext: set the ${NET.key === "mainnet" ? "MAINNET" : "NILE"}.purserPay address in ` +
      `src/lib/tron/config.ts to:`
  );
  console.log(`  ${address}`);
}

main().catch((e) => {
  console.error("\nDeploy failed:", e.message);
  process.exit(1);
});
