// Sprint 2 (structural) — the agency→agency cold-referral UI is GONE, and the shared
// /r/{code} + referral_accounts plumbing the LIVE affiliate→agency vector rides on is
// still intact. This is the regression guard for the one real risk of the removal:
// deleting the agency invite card must NOT break affiliate attribution.
//
// The agency→agency channel is dead by STRUCTURAL CONFLICT OF INTEREST (a paying agency
// won't hand a competitor the tool) — recorded here so a future "raise the bounty" fix
// can't quietly rebuild a structurally-dead channel. Freeze, don't destroy: the credit
// SCHEMA + claim path stay (see docs/08 §status); only the invite UI was removed.
// No network, no DB — pure source scan.
//   npm test   (node --test --experimental-strip-types "tests/**/*.test.ts")

import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8")
const path = (rel: string) => resolve(here, rel)

const DASHBOARD = "../../src/views/Dashboard.tsx"
const REFERRAL_CARD = "../../src/components/dashboard/ReferralCard.tsx"
const R_ROUTE = "../../src/app/r/[code]/route.ts"
const AFFILIATE_ACCOUNTS = "../../src/lib/affiliate/accounts.ts"
const REFERRAL_ACCOUNTS = "../../src/lib/referral/accounts.ts"

// --- Task 1: the agency invite UI is fully removed ---------------------------

test("the ReferralCard component file no longer exists", () => {
  assert.equal(existsSync(path(REFERRAL_CARD)), false, "ReferralCard.tsx must be deleted")
})

test("the dashboard no longer imports or renders ReferralCard", () => {
  const src = read(DASHBOARD)
  assert.doesNotMatch(src, /ReferralCard/, "no ReferralCard reference may remain in Dashboard")
  // The agency invite copy is gone with it.
  assert.doesNotMatch(src, /Share your link/i)
})

// --- Task 2: the shared plumbing the AFFILIATE vector needs is untouched ------

test("/r/{code} still resolves codes via referral_accounts (shared attribution)", () => {
  const src = read(R_ROUTE)
  // The affiliate's opaque code lives in referral_accounts too (is_affiliate=true), so
  // this resolver must keep validating against it — it is the live affiliate vector's
  // attribution gate, not only the (dead) agency one.
  assert.match(src, /referralCodeExists\(/, "/r/[code] must still call referralCodeExists")

  const resolver = read(REFERRAL_ACCOUNTS)
  assert.match(
    resolver,
    /referralCodeExists[\s\S]*from\(\s*["']referral_accounts["']\s*\)/,
    "referralCodeExists must still SELECT referral_accounts"
  )
})

test("the affiliate account bridge (ensure_affiliate_account) is intact", () => {
  const src = read(AFFILIATE_ACCOUNTS)
  assert.match(src, /ensureAffiliateAccount/)
  assert.match(src, /ensure_affiliate_account/, "affiliate codes still mint via ensure_affiliate_account")
})

// --- The DashboardHeader still HONORS earned credit (monotonic — never deny) --

test("the dashboard still passes earned credit to the header (grant-only, not removed)", () => {
  const src = read(DASHBOARD)
  // Removing the INVITE card must not stop DISPLAYING an already-earned/running credit
  // month — that would deny access the credit system granted (docs/08 §4 monotonic).
  assert.match(src, /creditActiveUntil=\{payout\.referralCreditActiveUntil\}/)
  assert.match(src, /monthsBanked=\{payout\.referralMonthsBanked\}/)
})
