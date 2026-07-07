// errors.js — confirm PurseDisperseUsdt's four custom guards fire and decode on
// real TVM. Closes the prior contract sprint's "confirm custom Solidity errors
// display on-chain" TODO, and feeds the report's TVM-vs-LOCAL section.
//
// Key finding this exercises: a constant/simulated call surfaces only a generic
// "REVERT opcode executed"; the decodable 4-byte custom-error selector is only in a
// MINED transaction's receipt.contractResult. So each guard is triggered as a real
// (early-revert, ~cheap) mined tx and decoded from contractResult.
//
// Reuses the contracts already deployed by measure.js (addresses read from
// measurements.json). Never prints the private key.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");

const M = require("./measurements.json");
const TOKEN = M.deployed.MockUsdtTrc20.address;
const DISPERSE = M.deployed.PurseDisperseUsdt.address;
const OUT = path.join(__dirname, "errors.json");
const FEE = 300 * L.SUN;

async function trigger(tronWeb, guard, recipients, amounts) {
  try {
    const res = await L.send(
      tronWeb,
      DISPERSE,
      "disperse(address,address[],uint256[])",
      [
        { type: "address", value: TOKEN },
        { type: "address[]", value: recipients },
        { type: "uint256[]", value: amounts },
      ],
      { feeLimit: FEE }
    );
    const cr = res.info.contractResult && res.info.contractResult[0];
    return {
      guard,
      txid: res.txid,
      txLink: L.trxLink(res.txid),
      result: res.energy.result,
      reverted: res.energy.result !== "SUCCESS",
      selector: cr ? "0x" + cr.slice(0, 8) : null,
      decodedError: L.decodeError(cr),
      energy: res.energy.energyTotal,
      trxBurned: L.sunToTrx(res.energy.energyFeeSun),
    };
  } catch (e) {
    return { guard, error: String(e.message || e) };
  }
}

(async () => {
  const tronWeb = L.getTronWeb();
  const payer = tronWeb.defaultAddress.base58;
  const ZERO = tronWeb.address.fromHex(
    "410000000000000000000000000000000000000000"
  );
  const out = { network: "nile", disperse: DISPERSE, token: TOKEN, checks: [] };

  // 1) len(recipients) != len(amounts) -> LengthMismatch (before the loop)
  out.checks.push(
    await trigger(tronWeb, "LengthMismatch", [payer], ["1000000", "2000000"])
  );
  // 2) both empty -> passes length check, then EmptyBatch
  out.checks.push(await trigger(tronWeb, "EmptyBatch", [], []));
  // 3) zero-address recipient at i=0 -> ZeroAddressRecipient (before any transfer)
  out.checks.push(
    await trigger(tronWeb, "ZeroAddressRecipient", [ZERO], ["1000000"])
  );
  // 4) zero amount at i=0 -> ZeroAmount (before any transfer)
  out.checks.push(await trigger(tronWeb, "ZeroAmount", [payer], ["0"]));

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  for (const c of out.checks) {
    console.log(
      `${c.guard.padEnd(22)} result=${c.result || "-"}  ` +
        `decoded=${c.decodedError || c.error}  sel=${c.selector || "-"}  ` +
        `energy=${c.energy || "-"}  txid=${c.txid || "-"}`
    );
  }
  console.log("Wrote", OUT);
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
