// verify-supabase.cjs — READ-ONLY Supabase verification for the PHASE 2 E2E suite.
//
// Uses the service-role client (server-only key from env) to run SELECTs against the
// compliance schema. It NEVER writes and NEVER decrypts PII — it only confirms the
// schema is applied and that a billing_profiles row exists for a given wallet's
// dissociated hash (existence + timestamps, not contents).
//
// The wallet hash mirrors src/lib/crypto.ts hashWalletAddress EXACTLY:
//   sha256(`${WALLET_SALT}:${address.trim()}`) as lowercase hex.
//
// Usage:
//   node scripts/verify-supabase.cjs            # schema check + Wallet 2 profile row
//   node scripts/verify-supabase.cjs <address>  # schema check + that address's row

const path = require("path");
const { createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT, ".env") });
require("dotenv").config({ path: path.join(ROOT, ".env.local") });

const { createClient } = require("@supabase/supabase-js");

const WALLET2 = "THfX1kFnhmPzA3dezaXy7EpXMaLYrJnEzi";
const targetAddress = process.argv[2] || WALLET2;

// Identical to src/lib/crypto.ts hashWalletAddress (trim only, never lowercase).
function hashWalletAddress(address, salt) {
  const normalized = address.trim();
  if (!normalized) throw new Error("address is required");
  if (!salt) throw new Error("WALLET_SALT is required");
  return createHash("sha256").update(`${salt}:${normalized}`).digest("hex");
}

function makeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.local)."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  console.log("──────────────────────────────────────────────────────────────");
  console.log("PHASE 2 E2E — read-only Supabase verification");
  console.log(`  project: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log("──────────────────────────────────────────────────────────────");

  const supabase = makeClient();

  // --- schema check: both tables selectable via service role ----------------
  console.log("\nSCHEMA");
  const bp = await supabase
    .from("billing_profiles")
    .select("wallet_hash", { count: "exact", head: true });
  console.log(
    bp.error
      ? `  billing_profiles:  ✗ ${bp.error.message}`
      : `  billing_profiles:  ✓ present (${bp.count ?? 0} rows)`
  );

  const of = await supabase
    .from("ofac_sanctions")
    .select("wallet_hash", { count: "exact", head: true });
  console.log(
    of.error
      ? `  ofac_sanctions:    ✗ ${of.error.message}`
      : `  ofac_sanctions:    ✓ present (${of.count ?? 0} rows)  ` +
          `— a clean OFAC pass needs the 3 test addresses absent here`
  );

  if (bp.error || of.error) {
    console.log(
      "\n⚠ Schema not fully applied. Apply supabase/migrations/0001_compliance_schema.sql " +
        "(SQL editor or `supabase db push`) — else OFAC screening fails CLOSED and TC4's " +
        "payout is blocked, and TC2's PII write throws."
    );
  }

  // --- billing_profiles row for the target wallet's hash -------------------
  const salt = process.env.WALLET_SALT;
  console.log("\nBILLING PROFILE (dissociated by wallet hash — PII never read here)");
  if (!salt) {
    console.log("  ⚠ WALLET_SALT not set — cannot compute the row key.");
  } else {
    const hash = hashWalletAddress(targetAddress, salt);
    console.log(`  address:     ${targetAddress}`);
    console.log(`  wallet_hash: ${hash}`);
    const { data, error } = await supabase
      .from("billing_profiles")
      .select("wallet_hash, created_at, updated_at")
      .eq("wallet_hash", hash)
      .maybeSingle();
    if (error) {
      console.log(`  row:         ✗ ${error.message}`);
    } else if (!data) {
      console.log("  row:         — none yet (expected BEFORE TC2; PASS AFTER TC2)");
    } else {
      console.log("  row:         ✓ present (encrypted PII stored, contents not read)");
      console.log(`  created_at:  ${data.created_at}`);
      console.log(`  updated_at:  ${data.updated_at}`);
    }
  }
}

main().catch((e) => {
  console.error("verify-supabase failed:", e.message);
  process.exit(1);
});
