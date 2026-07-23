// measure-mainnet.cjs — calibrate mainnet disperse energy WITHOUT spending a cent.
//
// HOW: triggerConstantContract executes disperse() on the node and returns energy_used —
// no signature, no broadcast, no TRX, no USDT moved. It is exactly what TronLink uses to
// quote a fee. This is a SIMULATION, not a receipt (see caveats printed at the end).
//
// STRUCTURALLY INCAPABLE OF BROADCASTING: this script builds a TronWeb with NO privateKey,
// and never calls sign() or sendRawTransaction(). It loads ONLY .env.local (for the
// mandatory TRON_PRO_API_KEY) — it does NOT load .env, so PRIVATE_KEY is never even in
// scope. It generates fresh recipient keypairs but keeps ONLY the addresses and never
// writes, logs, or persists a private key.
//
// Env:
//   TRON_PRO_API_KEY   (from .env.local) — MANDATORY on mainnet (keyless reads 429 without it).
//   MEASURE_WALLET     the caller the simulation runs "from" — must hold a little USDT AND
//                      have a standing allowance to PurserPay (a constant call still runs the
//                      real transferFrom, which checks both).
//
// Usage:
//   MEASURE_WALLET=T... node scripts/tron/measure-mainnet.cjs

const path = require("path");
// Load ONLY .env.local (has TRON_PRO_API_KEY). Deliberately NOT .env — that holds PRIVATE_KEY,
// which this read-only script must never touch.
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });

const { TronWeb } = require("tronweb");

// --- mainnet, hardcoded (this tool is mainnet-only by design) ---------------
const FULL_HOST = "https://api.trongrid.io";
const PURSERPAY = "TH6TVSJb7VG6fYjSGyHrHUhghJ1gg4PqXm"; // live mainnet PurserPay — S-1 GUARDED (S-4, 2026-07-23); supersedes pre-guard TLdySJX2pGRkD6jDNcJdtNd4bcLXCaYQha
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // mainnet Tether USD (6 dp)
const EXPLORER = "https://tronscan.org";

// Current frontend constants (config.ts), for the before/after comparison.
const CUR_BASE = 3_000;
const CUR_PER = 40_000;
const FEE_MARGIN = 1.5; // unchanged — keep the headroom
const BATCH_CAP = 100;

const Ns = [1, 2, 3, 5, 10];

// Candidate EXISTING USDT holders (verified live by balanceOf > 0 before use) — for the
// fresh-vs-existing delta. Well-known large TRON USDT wallets; MEASURE_WALLET is added too.
const EXISTING_CANDIDATES = [
  "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
  "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs",
  "TNaRAoLUyYEV2uF7GUrzSjRQTU8v5ZJ5VR",
  "TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa",
  "TVj7RNVHy6thbM7BWdr8B1J5jx1v6E9J1D",
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`${name} is required. Aborting.`);
  }
  return String(v).trim();
}

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

async function main() {
  const apiKey = process.env.TRON_PRO_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "TRON_PRO_API_KEY is REQUIRED on mainnet (public TronGrid rate-limits keyless traffic — " +
        "this exact read path already ate a 429 during the deploy). Set it in .env.local."
    );
  }
  const MEASURE_WALLET = requireEnv("MEASURE_WALLET");

  // Keyless client. No privateKey → cannot sign → cannot broadcast.
  const tw = new TronWeb({
    fullHost: FULL_HOST,
    headers: { "TRON-PRO-API-KEY": apiKey.trim() },
  });

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
  console.log("MAINNET energy calibration — CONSTANT-CALL SIMULATION (no spend)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  contract:       ${PURSERPAY}`);
  console.log(`  usdt:           ${USDT}`);
  console.log(`  measure wallet: ${MEASURE_WALLET}`);
  console.log(`  USDT balance:   ${(Number(balance) / 1e6).toLocaleString("en-US")} USDT`);
  console.log(`  allowance→Purser: ${(Number(allowance) / 1e6).toLocaleString("en-US")} USDT`);
  console.log("──────────────────────────────────────────────────────────────");

  const maxN = Math.max(...Ns);
  // Each recipient gets 1 BASE UNIT (0.000001 USDT). Energy does NOT scale with amount on
  // TRON — only with whether the recipient's storage slot must be created. So a 1-unit batch
  // measures the same energy as a 10,000-USDT batch, at zero cost.
  const needBaseUnits = BigInt(maxN); // total for the largest batch = maxN * 1
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

  // --- simulate disperse() for each N against FRESH recipients --------------------------
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

  console.log("\nFRESH-RECIPIENT SIMULATION (energy_used per batch size):");
  const freshEnergy = {};
  for (const n of Ns) {
    const { ok, energy, res } = await simulateDisperse(fresh.slice(0, n));
    if (!ok || energy == null) {
      const msg = res?.result?.message ? Buffer.from(res.result.message, "hex").toString("utf8") : "(revert)";
      console.error(`  N=${n}: SIMULATION REVERTED — ${msg}. Cannot calibrate. Aborting.`);
      process.exit(1);
    }
    freshEnergy[n] = energy;
    console.log(`  N=${String(n).padStart(2)}  energy_used = ${fmt(energy)}   (~${fmt(Math.round(energy / n))}/recipient incl. overhead)`);
  }

  // --- fresh vs existing: N=3 against verified existing USDT holders ---------------------
  const existing = [];
  for (const cand of [MEASURE_WALLET, ...EXISTING_CANDIDATES]) {
    if (existing.length >= 3) break;
    if (existing.includes(cand)) continue;
    try {
      const bal = await readUint(USDT, "balanceOf(address)", [{ type: "address", value: cand }]);
      if (bal > 0n) existing.push(cand);
    } catch {
      /* skip unreadable candidate */
    }
  }
  console.log("\nFRESH-vs-EXISTING (N=3): the fresh case is the WORST case AND the real case");
  console.log("(a new affiliate's virgin wallet costs ~2× — a brand-new USDT storage slot):");
  if (existing.length >= 1) {
    const { ok, energy } = await simulateDisperse(existing);
    if (ok && energy != null) {
      console.log(`  existing holders (${existing.length}): ${existing.join(", ")}`);
      console.log(`  N=3 existing energy = ${fmt(energy)}   vs fresh N=3 = ${fmt(freshEnergy[3])}` +
        `   → fresh/existing ≈ ${(freshEnergy[3] / energy).toFixed(2)}×`);
    } else {
      console.log("  existing-holder simulation reverted (likely their allowance/our path) — skipped.");
    }
  } else {
    console.log("  no existing USDT holder verified among candidates — skipped (fresh calibration stands).");
  }

  // --- solve BASE / PER from the endpoints, then sanity-check linearity ------------------
  const perRaw = (freshEnergy[10] - freshEnergy[1]) / 9;
  const baseRaw = freshEnergy[1] - perRaw;
  console.log("\nLINEAR FIT  energy(N) ≈ BASE + PER·N   (from N=1 and N=10 endpoints):");
  console.log(`  PER  (marginal per FRESH recipient) = ${perRaw.toFixed(1)}`);
  console.log(`  BASE (per-tx overhead)              = ${baseRaw.toFixed(1)}`);
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
    console.log("     does NOT fit well — do NOT trust a clean-looking feeLimit. Investigate before setting.");
  } else {
    console.log(`  ✓ linear (worst residual ${(worstResidual * 100).toFixed(1)}% ≤ 10%) — the model holds.`);
  }

  // --- round UP for config (over-provisioning costs nothing; under-provisioning kills payroll) ---
  const PER = Math.ceil(perRaw / 100) * 100; // round up to nearest 100
  const BASE = Math.ceil(baseRaw / 100) * 100;
  console.log("\nCONFIG CONSTANTS (rounded UP — feeLimit is a ceiling, never a charge):");
  console.log(`  ENERGY_PER_RECIPIENT_FRESH = ${fmt(PER)}   (was NILE ${fmt(CUR_PER)})`);
  console.log(`  ENERGY_BASE                = ${fmt(BASE)}   (was NILE ${fmt(CUR_BASE)})`);

  // --- feeLimit @ BATCH_CAP, in energy AND TRX (× LIVE getEnergyFee) ---------------------
  const params = await tw.trx.getChainParameters();
  const energyFee = Number((params.find((p) => p.key === "getEnergyFee") || {}).value || 0); // sun/energy
  const energyAt100 = BASE + PER * BATCH_CAP;
  const feeLimitEnergy = Math.ceil(energyAt100 * FEE_MARGIN);
  const feeLimitTrx = (feeLimitEnergy * energyFee) / 1e6;
  console.log(`\nfeeLimit @ BATCH_CAP=${BATCH_CAP}, ${FEE_MARGIN}× margin:`);
  console.log(`  raw energy(100)   = ${fmt(energyAt100)}`);
  console.log(`  feeLimit (energy) = ${fmt(feeLimitEnergy)}`);
  console.log(`  live getEnergyFee = ${energyFee} sun/energy`);
  console.log(`  feeLimit (TRX)    = ${feeLimitTrx.toFixed(2)} TRX   (protocol max is 15,000 TRX)`);

  // --- caveats (surfaced, not buried) ---------------------------------------------------
  console.log("\n══ CAVEATS — read these ═══════════════════════════════════════");
  console.log("  1. A constant call is a SIMULATION, not a receipt. It is the best estimate obtainable");
  console.log("     without spending — and what TronLink itself uses to quote fees — but not a broadcast tx.");
  console.log("  2. getAllowDynamicEnergy = 1 on mainnet: per-contract energy is NOT constant; a heavily-");
  console.log("     used contract is charged progressively more. This number is a FLOOR, not a law.");
  console.log("  3. Re-verify against a REAL receipt the FIRST time a batch runs on mainnet, and re-tune if off.");
  console.log("══════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("\nmeasure-mainnet failed:", e.message);
  process.exit(1);
});
