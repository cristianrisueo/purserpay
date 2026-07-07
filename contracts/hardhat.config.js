require("@nomicfoundation/hardhat-toolbox");

// This project tests PurseDisperseUsdt.sol's LOGIC ONLY, against Hardhat's local
// in-process EVM — it never deploys anywhere. TVM (TRON's virtual machine) is a fork
// of the EVM, and this contract uses none of the surface where the two diverge (no
// TRC10 precompiles, no native-value transfers, no proxy/assembly) — only `require`,
// a loop, events, and a standard external `transferFrom` call, all byte-identical in
// semantics on both. See sprint_report.txt for what still requires a manual TronIDE /
// Nile-testnet verification pass (real Energy cost, real address encoding, etc).
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      // TVM has historically lagged EVM hardforks. Pinning to "paris" (pre-PUSH0)
      // avoids a false-negative where tests pass locally against an opcode TronIDE's
      // compiler may not yet support at real deploy time. Flagged for manual
      // confirmation against TronIDE's current solc target in sprint_report.txt.
      evmVersion: "paris",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  // Standard Hardhat default paths (sources: "contracts", tests: "test", cache:
  // "cache", artifacts: "artifacts", all relative to this project's own root) — no
  // overrides. Hardhat requires `sources` to be a subdirectory of the project root
  // that does NOT itself contain node_modules (it errors with HH1006/HH1007
  // otherwise), which rules out a flat layout with the .sol file directly beside
  // package.json/node_modules. The nested default (contracts/contracts/*.sol) is the
  // same layout `npx hardhat init` itself scaffolds — see sprint_report.txt for the
  // exact-path deviation this causes from the sprint brief's literal
  // "contracts/PurseDisperseUsdt.sol", and why it's the right tradeoff.
};
