// ============================================================================
// ⛔ BROKEN — DO NOT RUN. DEAD SOURCE REFERENCES.
// ----------------------------------------------------------------------------
// This script (and its helper compile.cjs) compiles + deploys PurseDisperseUsdt.sol
// and mocks/MockUsdtTrc20.sol — BOTH DELETED from the repo when the contract was
// unified into contracts/src/PurserPay.sol. `compileAll()` therefore throws on a
// missing file; the script cannot run end-to-end. It is NOT repaired on purpose:
// mainnet energy cannot be measured with a mintable mock anyway (real USDT has no
// mint), so it is SUPERSEDED by empirical on-chain calibration — after the mainnet
// deploy, run ONE small real batch (2–3 recipients), read the exact energy from
// Tronscan, and tune ENERGY_* / feeLimitForBatch() in src/lib/tron/config.ts from
// that. See docs/06 "Calibrating energy on mainnet". Kept only as the historical
// record of how the Nile constants were originally derived.
// ============================================================================
//
// measure.js — Sprint 3B-measure orchestrator.
//
// Deploys MockUsdtTrc20 + PurseDisperseUsdt to the TRON Nile testnet, then
// measures how much Energy `disperse` costs per recipient (fresh vs already-funded
// recipients), derives a safe frontend batch cap, and verifies the money path and
// atomicity on real Nile. Writes measurements.json (checkpointed after every step)
// and prints a summary for the sprint report.
//
// Order is deliberate: the cheap correctness proofs (money path, atomicity) run
// BEFORE the expensive energy curve, so they still land even if the curve later
// exhausts the account's test-TRX.
//
// Never prints the private key. Reduced-curve + extrapolate strategy (owner
// decision): measure up to N=100, fit the line, derive the ceiling with margin
// rather than burning ~30k TRX driving a live OUT_OF_TIME.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { compileAll } = require("./compile.cjs");
const L = require("./lib.cjs");

const OUT = path.join(__dirname, "measurements.json");

// 6-decimal base units. 1 mUSDT = 1_000_000.
const UNIT = 1_000_000n;
const usdt = (whole) => (BigInt(whole) * UNIT).toString();

// feeLimit caps for THIS run. Kept safely below the account's liquid balance so a
// node never rejects a tx for feeLimit>balance as the balance depletes. These are
// ceilings, not charges — actual burn is far lower (N=100 disperse ≈ 500-650 TRX).
// The derived frontend ceiling (task 5) independently uses TRON's 15,000 TRX
// protocol max, not these test caps.
const DISPERSE_FEE = 1_200 * L.SUN; // 12M energy cap — covers N=100 with margin
const ADMIN_FEE = 500 * L.SUN; // mint/approve are ~single-digit TRX
const DEPLOY_FEE = 1_500 * L.SUN; // deploys are ~150 TRX; cap is plenty

const CURVE_N = [1, 3, 5, 10, 25, 50, 75, 100];

const results = {
  network: "nile",
  fullHost: L.FULL_HOST,
  startedAt: new Date().toISOString(),
  payer: null,
  payerStartTrx: null,
  compile: null,
  deployed: {},
  admin: {},
  moneyPath: null,
  atomicity: null,
  curve: [], // { n, mode: 'fresh'|'funded', energyTotal, energyPerRecipient, trxBurned, result, txid }
  energyPriceSun: null,
  ceiling: null,
  errors: [],
  finishedAt: null,
};

function checkpoint() {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}

function log(...a) {
  console.log(...a);
}

async function main() {
  // --- compile (offline, before touching the network) ---------------------
  log("Compiling (solc, evmVersion=istanbul)…");
  const artifacts = compileAll();
  results.compile = {
    solc: artifacts.solcVersion,
    evmVersion: "istanbul",
    disperseBytecodeBytes: (artifacts.PurseDisperseUsdt.bytecode.length - 2) / 2,
    mockBytecodeBytes: (artifacts.MockUsdtTrc20.bytecode.length - 2) / 2,
  };
  log(`  solc ${artifacts.solcVersion} — compile OK`);
  checkpoint();

  // --- connect + preflight ------------------------------------------------
  const tronWeb = L.getTronWeb();
  const payer = tronWeb.defaultAddress.base58;
  results.payer = payer;

  // energy price (sun per energy) from chain params
  try {
    const params = await tronWeb.trx.getChainParameters();
    const ef = params.find((p) => p.key === "getEnergyFee");
    if (ef) results.energyPriceSun = ef.value;
  } catch (e) {
    results.errors.push("getChainParameters failed: " + e.message);
  }
  const priceSun = results.energyPriceSun || 100;

  const balSun = await tronWeb.trx.getBalance(payer);
  results.payerStartTrx = L.sunToTrx(balSun);
  const res = await tronWeb.trx.getAccountResources(payer);
  const energyAvail = (res.EnergyLimit || 0) - (res.EnergyUsed || 0);
  results.payerEnergyAvailable = energyAvail;

  // Energy beyond the free (staked) pool is bought by burning liquid TRX at
  // priceSun. Rough total for the whole reduced run: deploys + curve + verifs.
  const APPROX_NEED_ENERGY = 24_000_000;
  const approxTrxNeeded =
    (Math.max(0, APPROX_NEED_ENERGY - energyAvail) * priceSun) / L.SUN;
  log(`Payer: ${payer}`);
  log(
    `  liquid: ${results.payerStartTrx} TRX  |  staked energy avail: ${energyAvail}  |  price: ${priceSun} sun/energy`
  );
  log(
    `  est. run needs ~${APPROX_NEED_ENERGY} energy => ~${Math.ceil(
      approxTrxNeeded
    )} TRX of liquid burn beyond staked energy`
  );
  checkpoint();

  // Hard stop if we can't even deploy the token (~1.3M energy) — don't waste the
  // small staked pool on a run that can't finish.
  const DEPLOY_ENERGY_FLOOR = 1_300_000;
  const affordableEnergy = energyAvail + balSun / priceSun;
  if (affordableEnergy < DEPLOY_ENERGY_FLOOR) {
    throw new Error(
      `Insufficient Nile resources. Affordable ~${Math.floor(affordableEnergy)} energy ` +
        `(staked ${energyAvail} + ${results.payerStartTrx} liquid TRX @ ${priceSun} sun), ` +
        `but deploying the token alone needs ~${DEPLOY_ENERGY_FLOOR}. ` +
        `Fund ${payer} with ~${Math.max(3000, Math.ceil(approxTrxNeeded))} liquid Nile TRX ` +
        `(faucet: https://nileex.io/join/getJoinPage), then re-run.`
    );
  }

  // --- deploy MockUsdtTrc20 -----------------------------------------------
  log("Deploying MockUsdtTrc20…");
  const mock = await L.deploy(
    tronWeb,
    artifacts.MockUsdtTrc20.abi,
    artifacts.MockUsdtTrc20.bytecode,
    { feeLimit: DEPLOY_FEE }
  );
  results.deployed.MockUsdtTrc20 = {
    address: mock.address,
    txid: mock.txid,
    energy: mock.energy.energyTotal,
    trxBurned: L.sunToTrx(mock.energy.energyFeeSun),
    tronscan: L.addrLink(mock.address),
    txLink: L.trxLink(mock.txid),
  };
  log(`  MockUsdtTrc20: ${mock.address}  (energy ${mock.energy.energyTotal})`);
  checkpoint();

  // --- deploy PurseDisperseUsdt -------------------------------------------
  log("Deploying PurseDisperseUsdt…");
  const disperse = await L.deploy(
    tronWeb,
    artifacts.PurseDisperseUsdt.abi,
    artifacts.PurseDisperseUsdt.bytecode,
    { feeLimit: DEPLOY_FEE }
  );
  results.deployed.PurseDisperseUsdt = {
    address: disperse.address,
    txid: disperse.txid,
    energy: disperse.energy.energyTotal,
    trxBurned: L.sunToTrx(disperse.energy.energyFeeSun),
    tronscan: L.addrLink(disperse.address),
    txLink: L.trxLink(disperse.txid),
  };
  log(`  PurseDisperseUsdt: ${disperse.address}  (energy ${disperse.energy.energyTotal})`);
  checkpoint();

  const TOKEN = mock.address;
  const DISPERSE = disperse.address;

  // --- mint + approve ------------------------------------------------------
  log("Minting test USDT to payer…");
  const MINT = usdt(10_000_000); // 10,000,000 mUSDT
  const mintRes = await L.send(
    tronWeb,
    TOKEN,
    "mint(address,uint256)",
    [
      { type: "address", value: payer },
      { type: "uint256", value: MINT },
    ],
    { feeLimit: ADMIN_FEE }
  );
  results.admin.mint = {
    txid: mintRes.txid,
    amount: MINT,
    energy: mintRes.energy.energyTotal,
    result: mintRes.energy.result,
  };
  log("Approving disperse contract (max)…");
  const approveRes = await L.send(
    tronWeb,
    TOKEN,
    "approve(address,uint256)",
    [
      { type: "address", value: DISPERSE },
      { type: "uint256", value: L.MAX_UINT256 },
    ],
    { feeLimit: ADMIN_FEE }
  );
  results.admin.approve = {
    txid: approveRes.txid,
    energy: approveRes.energy.energyTotal,
    trxBurned: L.sunToTrx(approveRes.energy.energyFeeSun),
    result: approveRes.energy.result,
  };
  log(`  approve energy ${approveRes.energy.energyTotal}`);
  checkpoint();

  // --- MONEY PATH (task 6) — cheap, run early -----------------------------
  log("Verifying money path (3 distinct amounts)…");
  {
    const recips = L.freshAddresses(tronWeb, 3);
    const amts = [usdt(2940), usdt(1600), usdt(1450)];
    const totalExpected = amts.reduce((a, b) => a + BigInt(b), 0n);
    const payerBefore = await L.readUint(tronWeb, TOKEN, "balanceOf(address)", [
      { type: "address", value: payer },
    ]);
    const res = await L.send(
      tronWeb,
      DISPERSE,
      "disperse(address,address[],uint256[])",
      [
        { type: "address", value: TOKEN },
        { type: "address[]", value: recips },
        { type: "uint256[]", value: amts },
      ],
      { feeLimit: DISPERSE_FEE }
    );
    const perRecipient = [];
    for (let i = 0; i < recips.length; i++) {
      const bal = await L.readUint(tronWeb, TOKEN, "balanceOf(address)", [
        { type: "address", value: recips[i] },
      ]);
      perRecipient.push({
        address: recips[i],
        expected: amts[i],
        got: bal.toString(),
        ok: bal === BigInt(amts[i]),
      });
    }
    const payerAfter = await L.readUint(tronWeb, TOKEN, "balanceOf(address)", [
      { type: "address", value: payer },
    ]);
    const ev = L.decodeDispersed(tronWeb, res.info);
    results.moneyPath = {
      txid: res.txid,
      txLink: L.trxLink(res.txid),
      result: res.energy.result,
      perRecipient,
      payerDebit: (payerBefore - payerAfter).toString(),
      payerDebitExpected: totalExpected.toString(),
      payerDebitOk: payerBefore - payerAfter === totalExpected,
      event: ev
        ? {
            payer: ev.payer,
            token: ev.token,
            recipientCount: ev.recipientCount.toString(),
            totalAmount: ev.totalAmount.toString(),
            payerOk: ev.payer === payer,
            tokenOk: ev.token === TOKEN,
            countOk: ev.recipientCount === 3n,
            totalOk: ev.totalAmount === totalExpected,
          }
        : null,
    };
    log(
      `  recipients ok: ${perRecipient.every((r) => r.ok)}  payer debit ok: ${
        results.moneyPath.payerDebitOk
      }  event: ${ev ? "fired" : "MISSING"}`
    );
    checkpoint();
  }

  // --- ATOMICITY (task 7) — under-approval revert, nobody paid ------------
  log("Verifying atomicity (under-approval revert)…");
  {
    const recips = L.freshAddresses(tronWeb, 3);
    const amts = [usdt(100), usdt(100), usdt(100)];
    const total = amts.reduce((a, b) => a + BigInt(b), 0n);
    // Approve exactly one base unit short of the total.
    await L.send(
      tronWeb,
      TOKEN,
      "approve(address,uint256)",
      [
        { type: "address", value: DISPERSE },
        { type: "uint256", value: (total - 1n).toString() },
      ],
      { feeLimit: ADMIN_FEE }
    );
    const res = await L.send(
      tronWeb,
      DISPERSE,
      "disperse(address,address[],uint256[])",
      [
        { type: "address", value: TOKEN },
        { type: "address[]", value: recips },
        { type: "uint256[]", value: amts },
      ],
      { feeLimit: DISPERSE_FEE }
    );
    const balances = [];
    for (const r of recips) {
      const bal = await L.readUint(tronWeb, TOKEN, "balanceOf(address)", [
        { type: "address", value: r },
      ]);
      balances.push({ address: r, got: bal.toString(), unchanged: bal === 0n });
    }
    results.atomicity = {
      txid: res.txid,
      txLink: L.trxLink(res.txid),
      result: res.energy.result, // expect REVERT
      reverted: res.energy.result !== "SUCCESS",
      decodedError: L.decodeError(
        res.info.contractResult && res.info.contractResult[0]
      ),
      resMessage: L.decodeResMessage(res.info),
      recipientsUnchanged: balances.every((b) => b.unchanged),
      balances,
    };
    log(
      `  reverted: ${results.atomicity.reverted} (${results.atomicity.result})  ` +
        `error: ${results.atomicity.decodedError}  nobody paid: ${results.atomicity.recipientsUnchanged}`
    );
    // Restore full allowance for the curve.
    await L.send(
      tronWeb,
      TOKEN,
      "approve(address,uint256)",
      [
        { type: "address", value: DISPERSE },
        { type: "uint256", value: L.MAX_UINT256 },
      ],
      { feeLimit: ADMIN_FEE }
    );
    checkpoint();
  }

  // --- ENERGY CURVE (task 4) — fresh then funded (same addresses) ---------
  log("Measuring energy curve (fresh + funded)…");
  let ranDry = false;
  for (const n of CURVE_N) {
    if (ranDry) break;
    const recips = L.freshAddresses(tronWeb, n);
    const amts = recips.map(() => UNIT.toString()); // 1 mUSDT each

    for (const mode of ["fresh", "funded"]) {
      try {
        const res = await L.send(
          tronWeb,
          DISPERSE,
          "disperse(address,address[],uint256[])",
          [
            { type: "address", value: TOKEN },
            { type: "address[]", value: recips },
            { type: "uint256[]", value: amts },
          ],
          { feeLimit: DISPERSE_FEE }
        );
        const e = res.energy;
        const row = {
          n,
          mode,
          result: e.result,
          pass: e.pass,
          energyTotal: e.energyTotal,
          energyPerRecipient: Math.round(e.energyTotal / n),
          energyPenalty: e.energyPenalty,
          trxBurned: L.sunToTrx(e.energyFeeSun),
          txid: res.txid,
          txLink: L.trxLink(res.txid),
        };
        results.curve.push(row);
        log(
          `  N=${String(n).padStart(3)} ${mode.padEnd(6)}  energy=${String(
            e.energyTotal
          ).padStart(8)}  /recip=${String(row.energyPerRecipient).padStart(
            6
          )}  TRX=${row.trxBurned.toFixed(1).padStart(7)}  ${e.result}`
        );
        checkpoint();
      } catch (err) {
        // Broadcast/network failure (most likely: out of TRX for feeLimit).
        results.curve.push({ n, mode, error: String(err.message || err) });
        results.errors.push(`curve N=${n} ${mode}: ${err.message || err}`);
        log(`  N=${n} ${mode}  FAILED: ${err.message || err}`);
        ranDry = true;
        checkpoint();
        break;
      }
    }
  }

  // --- CEILING (task 5) — derived from the fresh curve --------------------
  const fresh = results.curve.filter((r) => r.mode === "fresh" && r.pass);
  if (fresh.length >= 2) {
    // Least-squares fit energyTotal = E0 + Er * N
    const xs = fresh.map((r) => r.n);
    const ys = fresh.map((r) => r.energyTotal);
    const nPts = xs.length;
    const sx = xs.reduce((a, b) => a + b, 0);
    const sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0);
    const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
    const Er = (nPts * sxy - sx * sy) / (nPts * sxx - sx * sx);
    const E0 = (sy - Er * sx) / nPts;

    const priceSun = results.energyPriceSun || 420;
    const feeLimitMaxSun = 15_000 * L.SUN;
    const maxEnergyByFeeLimit = feeLimitMaxSun / priceSun;
    const nMaxFeeLimit = Math.floor((maxEnergyByFeeLimit - E0) / Er);

    results.ceiling = {
      fitFreshOverhead_E0: Math.round(E0),
      fitFreshPerRecipient_Er: Math.round(Er),
      energyPriceSun: priceSun,
      feeLimitMaxTrx: 15_000,
      maxEnergyByFeeLimit: Math.round(maxEnergyByFeeLimit),
      nMaxByFeeLimit: nMaxFeeLimit,
      note:
        "80ms-CPU OUT_OF_TIME not driven live (reduced-curve strategy, to conserve testnet TRX). " +
        "Frontend cap derived, not observed.",
    };
    log(
      `Ceiling fit (fresh): E0=${Math.round(E0)} Er=${Math.round(
        Er
      )}/recip  feeLimit-bound N≈${nMaxFeeLimit}`
    );
    checkpoint();
  } else {
    results.errors.push("Not enough fresh curve points to fit a ceiling.");
  }

  // --- wrap up ------------------------------------------------------------
  const endSun = await tronWeb.trx.getBalance(payer);
  results.payerEndTrx = L.sunToTrx(endSun);
  results.trxSpent = results.payerStartTrx - results.payerEndTrx;
  results.finishedAt = new Date().toISOString();
  checkpoint();
  log(
    `Done. TRX spent this run: ${results.trxSpent.toFixed(1)}  (end balance ${results.payerEndTrx})`
  );
  log(`Wrote ${OUT}`);
}

main().catch((err) => {
  results.errors.push("FATAL: " + (err.stack || err.message || String(err)));
  results.finishedAt = new Date().toISOString();
  try {
    checkpoint();
  } catch {}
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
