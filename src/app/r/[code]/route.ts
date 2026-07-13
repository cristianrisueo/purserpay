import { NextResponse, type NextRequest } from "next/server"

import { referralCodeExists } from "@/lib/referral/accounts"

// GET /r/{code} — referral attribution capture. Validate the code exists, drop the
// cookies, and 302 to the landing. This is the ONE irreversible bit of the whole loop
// (an uncaptured click is lost forever), so it runs REGARDLESS of REFERRALS_ENABLED —
// only GRANTING rewards is gated, never attribution.
//
// Three cookies:
//   * pp_ref               — the code, HttpOnly. The server reads it at claim time and
//                            never trusts a client-supplied referrer. FIRST-TOUCH: set
//                            only if absent, never overwritten, and its 30-day TTL is
//                            LOAD-BEARING (invitees browse and subscribe days later — do
//                            NOT shorten it).
//   * pp_invited           — readable "1" flag that drives the landing's invited banner
//                            (the HttpOnly code can't be read client-side). Re-set on
//                            every valid visit; leaks no code; keeps the landing static.
//   * pp_invited_dismissed — DELETED here so a NEW referral visit re-shows the banner
//                            (the banner's X sets it; it's UI-only, no attribution role).
//
// Node runtime: referralCodeExists uses the service-role Supabase client.
export const runtime = "nodejs"

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const res = NextResponse.redirect(new URL("/", request.url), 302)

  const clean = typeof code === "string" ? code.trim() : ""
  if (!clean) return res

  try {
    // Unknown code → redirect without touching any cookie. A DB blip does the same:
    // losing one attribution beats storing an unvalidated (bogus) code the claim path
    // would later trust.
    if (!(await referralCodeExists(clean))) return res
  } catch {
    return res
  }

  // Valid referral visit → (re)show the banner: refresh the readable flag and clear any
  // prior dismissal so a new visit re-shows it. Neither cookie affects attribution.
  res.cookies.set("pp_invited", "1", {
    httpOnly: false,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  })
  res.cookies.set("pp_invited_dismissed", "", { maxAge: 0, path: "/" })

  // First-touch attribution: set pp_ref ONLY if absent — never overwrite it, never
  // shorten its TTL. This is the load-bearing cookie the claim path reads.
  if (!request.cookies.get("pp_ref")) {
    res.cookies.set("pp_ref", clean, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    })
  }

  return res
}
