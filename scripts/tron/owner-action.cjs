// owner-action.cjs — exercise the owner-only updateTreasuryWallet, safely.
//
// updateTreasuryWallet is the ONE new owner power in this contract (redirect where our
// OWN subscription fee is sent — never user funds; disperse() never references treasury).
// It has only ever run inside Foundry. This script drives it once against a live contract:
//
//   read treasuryWallet()  ->  updateTreasuryWallet(<throwaway>)  ->  read back (must change)
//   ->  updateTreasuryWallet(<ORIGINAL_TREASURY>)  ->  read back (must revert)
//
// The revert to the real treasury is the FINAL, guaranteed step, so the fee destination is
// never left pointing at a wallet we don't control. No subscribe happens in between, so no
// fee could ever route to the throwaway even for an instant of wall-clock.
//
// It is ALSO the tool for the mainnet cold/multisig move later: run it with
// ORIGINAL_TREASURY = the hot key and let it point at the cold wallet (skip the revert by
// setting REVERT=0 — see below).
//
// EVERYTHING is env-driven with NO defaults (fail closed). PRIVATE_KEY is read from a
// gitignored .env (dotenv) and NEVER printed. Dry by default: a bare run prints the plan and
// broadcasts nothing; pass CONFIRM=1 to broadcast.
//
//   DEPLOY_NETWORK      "nile" | "mainnet"
//   PURSERPAY_ADDRESS   the deployed contract
//   ORIGINAL_TREASURY   the CURRENT treasury (asserted on-chain before we touch anything)
//   NEW_TREASURY        optional: the address to point at. If unset, a throwaway is generated.
//   REVERT              optional: "0" to leave the treasury at NEW_TREASURY (the real move);
//                       default "1" = round-trip back to ORIGINAL_TREASURY (the rehearsal).
//
// Usage:
//   DEPLOY_NETWORK=nile PURSERPAY_ADDRESS=… ORIGINAL_TREASURY=… node scripts/tron/owner-action.cjs
//   … CONFIRM=1 node scripts/tron/owner-action.cjs

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

// Decode an address returned by a constant call (right-aligned 32-byte word) → base58.
function addrFromWord(tronWeb, hexWord) {
  if (!hexWord) return null;
  const clean = hexWord.replace(/^0x/, "");
  return tronWeb.address.fromHex("41" + clean.slice(-40));
}

const FEE = 100 * L.SUN; // a single storage write is cheap; 100 TRX ceiling, only usage burns.

async function main() {
  const NET = L.resolveNetwork(); // validates DEPLOY_NETWORK
  const PURSERPAY = requireEnv("PURSERPAY_ADDRESS");
  const ORIGINAL_TREASURY = requireEnv("ORIGINAL_TREASURY");
  const REVERT = process.env.REVERT !== "0"; // default: round-trip back
  const confirm = process.env.CONFIRM === "1";

  const tronWeb = L.getTronWeb(); // throws if PRIVATE_KEY unset; key never printed
  const signer = tronWeb.defaultAddress.base58;

  // Generate a throwaway target unless one was supplied.
  const NEW_TREASURY =
    process.env.NEW_TREASURY && process.env.NEW_TREASURY.trim() !== ""
      ? process.env.NEW_TREASURY.trim()
      : L.freshAddresses(tronWeb, 1)[0];

  // --- pre-flight reads (owner + current treasury must match expectations) ---
  const ownerBack = addrFromWord(tronWeb, await L.constCall(tronWeb, PURSERPAY, "owner()", []));
  const treasuryBack = addrFromWord(
    tronWeb,
    await L.constCall(tronWeb, PURSERPAY, "treasuryWallet()", [])
  );

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`updateTreasuryWallet — ${NET.key} — preflight`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  contract:            ${PURSERPAY}`);
  console.log(`  signer:              ${signer}`);
  console.log(`  owner() on-chain:    ${ownerBack} ${ownerBack === signer ? "✓ (signer is owner)" : "✗ NOT OWNER"}`);
  console.log(`  treasuryWallet() now:${treasuryBack}`);
  console.log(`  ORIGINAL_TREASURY:   ${ORIGINAL_TREASURY} ${treasuryBack === ORIGINAL_TREASURY ? "✓ (matches on-chain)" : "✗ MISMATCH"}`);
  console.log(`  will set treasury →  ${NEW_TREASURY}${process.env.NEW_TREASURY ? "" : " (generated throwaway)"}`);
  console.log(`  then revert →        ${REVERT ? ORIGINAL_TREASURY : "(REVERT=0 — leaving it at the above)"}`);
  console.log(`  feeLimit ceiling:    ${L.sunToTrx(FEE)} TRX`);
  console.log("──────────────────────────────────────────────────────────────");

  if (ownerBack !== signer) {
    throw new Error(`Signer ${signer} is not the contract owner (${ownerBack}). Aborting.`);
  }
  if (treasuryBack !== ORIGINAL_TREASURY) {
    throw new Error(
      `On-chain treasury (${treasuryBack}) != ORIGINAL_TREASURY (${ORIGINAL_TREASURY}). ` +
        `Refusing to run so the revert target is never wrong. Aborting.`
    );
  }

  if (!confirm) {
    console.log("\nDRY — nothing broadcast. Re-run with CONFIRM=1 to execute.\n");
    return;
  }

  // --- 1) point treasury at NEW_TREASURY -------------------------------------
  console.log(`\nBroadcasting updateTreasuryWallet(${NEW_TREASURY})…`);
  const r1 = await L.send(
    tronWeb,
    PURSERPAY,
    "updateTreasuryWallet(address)",
    [{ type: "address", value: NEW_TREASURY }],
    { feeLimit: FEE }
  );
  if (r1.energy.result !== "SUCCESS") {
    throw new Error(`updateTreasuryWallet(new) did not succeed: ${r1.energy.result} (txid ${r1.txid})`);
  }
  const after1 = addrFromWord(tronWeb, await L.constCall(tronWeb, PURSERPAY, "treasuryWallet()", []));
  console.log(`  txid: ${r1.txid}  ${L.trxLink(r1.txid)}`);
  console.log(`  treasuryWallet() → ${after1} ${after1 === NEW_TREASURY ? "✓ changed" : "✗ UNEXPECTED"}`);
  if (after1 !== NEW_TREASURY) throw new Error("Read-back after set does not match NEW_TREASURY.");

  if (!REVERT) {
    console.log("\nREVERT=0 — leaving the treasury at the new address (the real move). Done.");
    return;
  }

  // --- 2) revert to ORIGINAL_TREASURY (guaranteed final step) ----------------
  console.log(`\nReverting: updateTreasuryWallet(${ORIGINAL_TREASURY})…`);
  const r2 = await L.send(
    tronWeb,
    PURSERPAY,
    "updateTreasuryWallet(address)",
    [{ type: "address", value: ORIGINAL_TREASURY }],
    { feeLimit: FEE }
  );
  if (r2.energy.result !== "SUCCESS") {
    throw new Error(
      `REVERT updateTreasuryWallet(original) did not succeed: ${r2.energy.result} (txid ${r2.txid}). ` +
        `TREASURY MAY BE LEFT AT ${NEW_TREASURY} — re-run to revert!`
    );
  }
  const after2 = addrFromWord(tronWeb, await L.constCall(tronWeb, PURSERPAY, "treasuryWallet()", []));
  console.log(`  txid: ${r2.txid}  ${L.trxLink(r2.txid)}`);
  console.log(`  treasuryWallet() → ${after2} ${after2 === ORIGINAL_TREASURY ? "✓ reverted" : "✗ NOT REVERTED"}`);
  if (after2 !== ORIGINAL_TREASURY) throw new Error("Treasury did NOT revert — re-run immediately.");

  console.log("\n✓ Round-trip complete: treasury changed then reverted to the original. Two");
  console.log("  TreasuryWalletUpdated events emitted; the fee destination is back to normal.");
}

main().catch((e) => {
  console.error("\nowner-action failed:", e.message);
  process.exit(1);
});
