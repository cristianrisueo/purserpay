"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

// The one calm line an invited visitor sees. Reads the READABLE pp_invited flag set
// by /r/{code} (the sensitive pp_ref code stays HttpOnly for the server). We are
// honest — the invitee gets nothing but their own future link; NEVER imply a discount.
//
// Dismissible: an X sets a SEPARATE readable pp_invited_dismissed cookie and hides the
// banner. This is a UI preference ONLY — it never touches pp_ref (attribution) or
// pp_invited, so dismissing has ZERO effect on the referral. A fresh /r/{code} visit
// clears the dismissal (server-side) so the banner re-shows.
//
// Starts hidden so the server render and the first client render match (no hydration
// mismatch), then reveals after mount if invited AND not dismissed. Keeping this a small
// client island lets the landing stay a statically-rendered Server Component.

const DISMISS_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function hasCookie(name: string): boolean {
  if (typeof document === "undefined") return false
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${name}=`))
}

export function InvitedBanner() {
  const [visible, setVisible] = useState(false)
  // Defer the read to a microtask so the setState isn't synchronous in the effect body
  // (matches LandingWalletCta). Show only when invited AND not previously dismissed.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setVisible(hasCookie("pp_invited") && !hasCookie("pp_invited_dismissed"))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  function dismiss() {
    // UI preference only — deliberately NEVER touches pp_ref or pp_invited.
    document.cookie = `pp_invited_dismissed=1; max-age=${DISMISS_MAX_AGE}; path=/; samesite=lax`
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="mx-auto w-full max-w-[1160px] px-8 pt-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-border bg-card px-5 py-3.5">
        <p className="min-w-0 flex-1 text-[14px] leading-[1.55] text-muted-foreground">
          <span className="font-semibold text-foreground">Invited to PurserPay.</span>{" "}
          Full price, no gimmicks — and you&apos;ll get your own link the moment
          you&apos;re in.
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
