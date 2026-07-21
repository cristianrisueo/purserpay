// measure-nile.cjs — calibrate NILE disperse energy for the S-1 GUARDED contract, WITHOUT spending.
//
// Sibling of measure-mainnet.cjs (same method, same safety), Nile-parameterised. HOW:
// triggerConstantContract executes disperse() on the node and returns energy_used — no signature,
// no broadcast, no TRX, no USDT moved. It is exactly what TronLink uses to quote a fee. This is a
// SIMULATION, not a receipt (see caveats printed at the end).
//
// STRUCTURALLY INCAPABLE OF BROADCASTING: builds a TronWeb with NO privateKey, and never calls
// sign() or sendRawTransaction(). It loads ONLY .env.local (for the OPTIONAL TRON_PRO_API_KEY on
// Nile) — it does NOT load .env, so PRIVATE_KEY is never even in scope. It generates fresh
// recipient keypairs but keeps ONLY the addresses and never writes, logs, or persists a key.
//
// PURPOSE (N-1 — the S-4 dress rehearsal). Measure the S-1 frozen-address guard's REAL per-row
// energy on Nile: the guard adds, per recipient, one getBlackListStatus STATICCALL + one SLOAD on
// USDT (plus one once for the payer). S-1 estimated this as "trivial but not zero" — this turns it
// into a number, comparing the guarded contract against the pre-guard NILE baseline (~36,925 energy
// / fresh recipient — see config.ts / docs/06 §6).
//
// ⚠ NILE-ONLY. Nile's testnet USDT is NOT representative of mainnet Tether (the pre-guard Nile
// number was 3.9× UNDER the real mainnet figure). Do NOT copy anything printed here into the
// mainnet ENERGY_* constants — mainnet re-measures at S-4 against its OWN guarded contract. This
// number is the guard's Nile ORDER OF MAGNITUDE / delta only.
//
// Env:
//   PURSERPAY_ADDRESS  the freshly-deployed guarded Nile contract (required — no default).
//   MEASURE_WALLET     the caller the simulation runs "from" — must hold a little Nile USDT AND a
//                      standing allowance to PURSERPAY (a constant call still runs the real
//                      transferFrom, which checks both). (required)
//   USDT_ADDRESS       optional; defaults to the Nile USDT (Tether USD, 6dp) below.
//   TRON_PRO_API_KEY   optional on Nile (attached for parity if present in .env.local).
//
// Usage:
//   PURSERPAY_ADDRESS=T... MEASURE_WALLET=T... node scripts/tron/measure-nile.cjs

const path = require("path");
// Load ONLY .env.local (may hold TRON_PRO_API_KEY). Deliberately NOT .env — that holds PRIVATE_KEY,
// which this read-only script must never touch.
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });

const { TronWeb } = require("tronweb");

// --- nile, hardcoded host (this tool is nile-only by design) ----------------
const FULL_HOST = "https://nile.trongrid.io";
const DEFAULT_USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // Nile USDT (Tether USD, 6 dp)
const EXPLORER = "https://nile.tronscan.org";

// Pre-guard NILE baseline (measured in the earlier Nile rehearsal, recorded in config.ts / docs/06
// §6): ~36,925 energy / FRESH recipient. The delta below = guarded_PER − this = the guard's cost.
const PRE_GUARD_NILE_PER = 36_925;

const FEE_MARGIN = 1.5; // unchanged — the headroom the frontend uses
const BATCH_CAP = 100;

const Ns = [1, 2, 3, 5, 10];

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`${name} is required (no default). Set it before running. Aborting.`);
  }
  return String(v).trim();
}

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

async function main() {
  const PURSERPAY = requireEnv("PURSERPAY_ADDRESS");
  const MEASURE_WALLET = requireEnv("MEASURE_WALLET");
  const USDT = (process.env.USDT_ADDRESS && process.env.USDT_ADDRESS.trim()) || DEFAULT_USDT;

  // Keyless client (Nile API key optional). No privateKey → cannot sign → cannot broadcast.
  const apiKey = process.env.TRON_PRO_API_KEY;
  const headers = apiKey && apiKey.trim() !== "" ? { "TRON-PRO-API-KEY": apiKey.trim() } : undefined;
  const tw = new TronWeb({ fullHost: FULL_HOST, headers });

  // --- reads: caller balance + allowance (the simulation runs the REAL transferFrom) ---
  const readUint = async (contract, sig, params) => {
    const r = await tw.transactionBuilder.triggerConstantContract(contract, sig, {}, params, MEASURE_WALLET);
    const hex = r?.constant_result?.[0];
    return hex ? BigInt("0x" + hex) : 0n;
  };
  const balance = await readUint(USDT, "balanceOf(address)", [{ type: "address", value: MEASURE_WALLET }]);
  const allowance = await readUint(USDT, "allowance(address,address)", [
    { type: "address", value: MEASURE_WALLET },
    { type: "address", value: PURSERPAY },
  ]);

  console.log("──────────────────────────────────────────────────────────────");
  console.log("NILE energy calibration — S-1 GUARDED contract — CONSTANT-CALL SIMULATION (no spend)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  contract:       ${PURSERPAY}`);
  console.log(`  usdt:           ${USDT}`);
  console.log(`  measure wallet: ${MEASURE_WALLET}`);
  console.log(`  USDT balance:   ${(Number(balance) / 1e6).toLocaleString("en-US")} USDT`);
  console.log(`  allowance→Purser: ${(Number(allowance) / 1e6).toLocaleString("en-US")} USDT`);
  console.log("──────────────────────────────────────────────────────────────");

  const maxN = Math.max(...Ns);
  // Each recipient gets 1 BASE UNIT (0.000001 USDT). Energy does NOT scale with amount on TRON —
  // only with whether the recipient's storage slot must be created. So a 1-unit batch measures the
  // same energy as a 10,000-USDT batch, at zero cost.
  const needBaseUnits = BigInt(maxN);
  if (allowance < needBaseUnits) {
    console.error(
      `\n✗ ABORT: allowance to PurserPay is ${allowance} base units, need ≥ ${needBaseUnits} for the\n` +
        `  N=${maxN} simulation. A constant call still runs disperse()'s real transferFrom, which\n` +
        `  reverts on a zero/short allowance — you'd get an ERROR, not a measurement.\n` +
        `  Approve PurserPay for a small amount ONCE (e.g. 1 USDT — a tiny, one-time ~1.5 TRX tx),\n` +
        `  then re-run. Approve target: ${PURSERPAY} on USDT ${USDT} from ${MEASURE_WALLET}.`
    );
    process.exit(1);
  }
  if (balance < needBaseUnits) {
    console.error(
      `\n✗ ABORT: USDT balance ${balance} base units < ${needBaseUnits} needed. Fund a fraction of a` +
        ` USDT to ${MEASURE_WALLET} and re-run.`
    );
    process.exit(1);
  }

  // --- generate 10 FRESH recipients (addresses only; keys discarded immediately) --------
  const fresh = [];
  for (let i = 0; i < maxN; i++) {
    const acct = tw.utils.accounts.generateAccount(); // { privateKey, publicKey, address }
    fresh.push(acct.address.base58); // keep ONLY the address; privateKey is never read/stored
  }
  console.log("\nFRESH RECIPIENTS (generated just now → GUARANTEED to have never held USDT;");
  console.log("private keys discarded immediately, never funded, never signed for):");
  fresh.forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}. ${a}`));

  // --- simulate disperse() for each N against FRESH recipients (guard runs on every row) --
  async function simulateDisperse(recipients) {
    const amounts = recipients.map(() => "1"); // 1 base unit each
    const res = await tw.transactionBuilder.triggerConstantContract(
      PURSERPAY,
      "disperse(address,address[],uint256[])",
      {},
      [
        { type: "address", value: USDT },
        { type: "address[]", value: recipients },
        { type: "uint256[]", value: amounts },
      ],
      MEASURE_WALLET
    );
    const ok = res?.result?.result === true;
    return { ok, energy: res?.energy_used ?? null, res };
  }

  console.log("\nFRESH-RECIPIENT SIMULATION (energy_used per batch size — WITH the S-1 guard):");
  const freshEnergy = {};
  for (const n of Ns) {
    const { ok, energy, res } = await simulateDisperse(fresh.slice(0, n));
    if (!ok || energy == null) {
      const msg = res?.result?.message ? Buffer.from(res.result.message, "hex").toString("utf8") : "(revert)";
      console.error(`  N=${n}: SIMULATION REVERTED — ${msg}. Cannot calibrate. Aborting.`);
      console.error(
        `  (If this is a blacklist-read revert, the Nile USDT lacks getBlackListStatus and the guard\n` +
          `   cannot run here — but that was verified present before deploy, so check allowance/balance.)`
      );
      process.exit(1);
    }
    freshEnergy[n] = energy;
    console.log(`  N=${String(n).padStart(2)}  energy_used = ${fmt(energy)}   (~${fmt(Math.round(energy / n))}/recipient incl. overhead)`);
  }

  // --- fresh vs existing (N=1): MEASURE_WALLET already holds USDT, so its slot exists -----
  console.log("\nFRESH-vs-EXISTING (N=1): fresh is the WORST case AND the real case (a new affiliate's");
  console.log("virgin wallet writes a brand-new USDT storage slot):");
  {
    const { ok, energy } = await simulateDisperse([MEASURE_WALLET]);
    if (ok && energy != null) {
      console.log(`  existing holder (self): ${MEASURE_WALLET}`);
      console.log(`  N=1 existing energy = ${fmt(energy)}   vs fresh N=1 = ${fmt(freshEnergy[1])}` +
        `   → fresh/existing ≈ ${(freshEnergy[1] / energy).toFixed(2)}×`);
    } else {
      console.log("  existing-holder simulation reverted — skipped (fresh calibration stands).");
    }
  }

  // --- solve BASE / PER from the endpoints, then sanity-check linearity ------------------
  const perRaw = (freshEnergy[10] - freshEnergy[1]) / 9;
  const baseRaw = freshEnergy[1] - perRaw;
  console.log("\nLINEAR FIT  energy(N) ≈ BASE + PER·N   (from N=1 and N=10 endpoints):");
  console.log(`  PER  (marginal per FRESH recipient, GUARDED) = ${perRaw.toFixed(1)}`);
  console.log(`  BASE (per-tx overhead, incl. payer guard)    = ${baseRaw.toFixed(1)}`);
  console.log("  sanity-check vs measured N=2,3,5:");
  let worstResidual = 0;
  for (const n of [2, 3, 5]) {
    const predicted = baseRaw + perRaw * n;
    const measured = freshEnergy[n];
    const resid = Math.abs(predicted - measured) / measured;
    worstResidual = Math.max(worstResidual, resid);
    console.log(`    N=${n}: predicted ${fmt(Math.round(predicted))}  measured ${fmt(measured)}  Δ ${(resid * 100).toFixed(1)}%`);
  }
  if (worstResidual > 0.1) {
    console.log(`  ⚠⚠ NON-LINEAR: worst residual ${(worstResidual * 100).toFixed(1)}% > 10%. The BASE+PER·N model`);
    console.log("     does NOT fit well — investigate before trusting any feeLimit derived from it.");
  } else {
    console.log(`  ✓ linear (worst residual ${(worstResidual * 100).toFixed(1)}% ≤ 10%) — the model holds.`);
  }

  // --- THE deliverable: the guard's per-recipient delta vs the pre-guard Nile baseline ---
  const perGuardDelta = perRaw - PRE_GUARD_NILE_PER;
  const perGuardPct = (perGuardDelta / PRE_GUARD_NILE_PER) * 100;
  console.log("\n══ GUARD ENERGY DELTA (the S-1 GAP this run closes, on NILE) ═══════════════════");
  console.log(`  pre-guard NILE  (baseline)     ≈ ${fmt(PRE_GUARD_NILE_PER)} energy / fresh recipient`);
  console.log(`  guarded  NILE   (this run)     = ${fmt(Math.round(perRaw))} energy / fresh recipient`);
  console.log(`  GUARD DELTA (per recipient)    = ${perGuardDelta >= 0 ? "+" : ""}${fmt(Math.round(perGuardDelta))} energy  (${perGuardPct >= 0 ? "+" : ""}${perGuardPct.toFixed(1)}%)`);
  console.log(`  ≈ one getBlackListStatus STATICCALL + one SLOAD per row (the guard reads USDT's blacklist).`);
  console.log("══════════════════════════════════════════════════════════════");

  // --- feeLimit @ BATCH_CAP, in energy AND TRX (× LIVE getEnergyFee) — Nile context only --
  const PER = Math.ceil(perRaw / 100) * 100;
  const BASE = Math.ceil(baseRaw / 100) * 100;
  const params = await tw.trx.getChainParameters();
  const energyFee = Number((params.find((p) => p.key === "getEnergyFee") || {}).value || 0); // sun/energy
  const energyAt100 = BASE + PER * BATCH_CAP;
  const feeLimitEnergy = Math.ceil(energyAt100 * FEE_MARGIN);
  const feeLimitTrx = (feeLimitEnergy * energyFee) / 1e6;
  console.log(`\nfeeLimit @ BATCH_CAP=${BATCH_CAP}, ${FEE_MARGIN}× margin (NILE numbers — context only):`);
  console.log(`  ENERGY_PER_RECIPIENT (rounded up) = ${fmt(PER)}   ENERGY_BASE = ${fmt(BASE)}`);
  console.log(`  raw energy(100)   = ${fmt(energyAt100)}`);
  console.log(`  feeLimit (energy) = ${fmt(feeLimitEnergy)}`);
  console.log(`  live getEnergyFee = ${energyFee} sun/energy`);
  console.log(`  feeLimit (TRX)    = ${feeLimitTrx.toFixed(2)} TRX   (protocol max is 15,000 TRX)`);

  // --- caveats (surfaced, not buried) ---------------------------------------------------
  console.log("\n══ CAVEATS — read these ═══════════════════════════════════════");
  console.log("  1. A constant call is a SIMULATION, not a receipt. Best estimate without spending.");
  console.log("  2. NILE-ONLY. Do NOT set the mainnet ENERGY_* constants from this — mainnet Tether is");
  console.log("     NOT the Nile USDT (the pre-guard Nile number was 3.9× under mainnet). S-4 re-measures.");
  console.log("  3. This isolates the GUARD DELTA (guarded − pre-guard) on the SAME chain, which IS");
  console.log("     transferable as an order of magnitude for what the guard adds on mainnet.");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`\n(explorer: ${EXPLORER}/#/contract/${PURSERPAY})`);
}

main().catch((e) => {
  console.error("\nmeasure-nile failed:", e.message);
  process.exit(1);
});
