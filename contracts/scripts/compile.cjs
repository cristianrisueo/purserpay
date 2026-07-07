// compile.js — solc-js compile of the two contracts we deploy to Nile.
//
// The critical knob is evmVersion: "istanbul". solc 0.8.20 defaults to the
// "shanghai" target, which emits the PUSH0 (0x5f) opcode. TRON's TVM does not
// support PUSH0, so shanghai bytecode can fail to deploy or brick the contract.
// "istanbul" is the conservative, TRON-compatible target (no PUSH0 / MCOPY).
//
// OpenZeppelin imports (@openzeppelin/contracts/...) are resolved off disk from
// this folder's node_modules via the solc import callback. OZ's own files import
// each other relatively; solc normalizes those against the importer's source-unit
// name, so they arrive at the callback already prefixed with @openzeppelin/... and
// resolve the same way.

const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.resolve(__dirname, "..");
// Deps may live in a scripts-local node_modules (legacy) or the repo-root one
// (after the package.json merge). Check both.
const NODE_MODULES_DIRS = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../../node_modules"),
];

// Resolve an import path to file contents for the solc callback.
function findImport(importPath) {
  // Every import in our sources is an @openzeppelin/... package path.
  for (const dir of NODE_MODULES_DIRS) {
    const full = path.join(dir, importPath);
    if (fs.existsSync(full)) {
      return { contents: fs.readFileSync(full, "utf8") };
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function readContract(relPath) {
  return fs.readFileSync(path.join(CONTRACTS_DIR, relPath), "utf8");
}

// Compile both contracts and return { PurseDisperseUsdt, MockUsdtTrc20 },
// each { abi, bytecode } with a 0x-prefixed bytecode string.
function compileAll() {
  const input = {
    language: "Solidity",
    sources: {
      "PurseDisperseUsdt.sol": { content: readContract("PurseDisperseUsdt.sol") },
      "MockUsdtTrc20.sol": { content: readContract("mocks/MockUsdtTrc20.sol") },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // TRON-compatible target — see header note. Do NOT bump to shanghai.
      evmVersion: "istanbul",
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImport })
  );

  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length) {
    const msg = errors.map((e) => e.formattedMessage).join("\n");
    throw new Error(`Solidity compilation failed:\n${msg}`);
  }

  const disperse = output.contracts["PurseDisperseUsdt.sol"]["PurseDisperseUsdt"];
  const mock = output.contracts["MockUsdtTrc20.sol"]["MockUsdtTrc20"];

  if (!disperse || !mock) {
    throw new Error("Expected contracts not found in solc output.");
  }

  return {
    solcVersion: solc.version(),
    PurseDisperseUsdt: {
      abi: disperse.abi,
      bytecode: "0x" + disperse.evm.bytecode.object,
    },
    MockUsdtTrc20: {
      abi: mock.abi,
      bytecode: "0x" + mock.evm.bytecode.object,
    },
  };
}

module.exports = { compileAll };

// CLI: `node compile.js` verifies compilation offline (no key, no network).
if (require.main === module) {
  const out = compileAll();
  const dLen = (out.PurseDisperseUsdt.bytecode.length - 2) / 2;
  const mLen = (out.MockUsdtTrc20.bytecode.length - 2) / 2;
  console.log(`solc:            ${out.solcVersion}`);
  console.log(`evmVersion:      istanbul (no PUSH0 — TVM safe)`);
  console.log(`PurseDisperseUsdt bytecode: ${dLen} bytes, ${out.PurseDisperseUsdt.abi.length} ABI entries`);
  console.log(`MockUsdtTrc20     bytecode: ${mLen} bytes, ${out.MockUsdtTrc20.abi.length} ABI entries`);
  console.log("Compilation OK.");
}
