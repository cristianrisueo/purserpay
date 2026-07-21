"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"

// The receipt portal is ONE fixed URL for every payee — no code, no cookies; identity comes from the
// payee's own wallet signature (see docs/09 + src/app/portal/page.tsx). So the operator shares the
// same link with all their payees; each opens it, signs, and sees only their own receipts. This
// button copies that absolute link so the operator can hand it out. Reuses the copy idiom from the
// portal's own ReferralPanel. Read-only, device-local — no funds, no keys, no server call.
const PORTAL_PATH = "/portal"

export function PortalLinkButton() {
  // Lazy, render-pure origin read (matches the portal's ReferralPanel). Empty until mounted; the
  // dashboard is a client-only (ssr:false) view, so `window` is present by the time this renders.
  const [origin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  )
  const [copied, setCopied] = useState(false)

  const link = origin ? `${origin}${PORTAL_PATH}` : PORTAL_PATH

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op; nothing sensitive, the link is public */
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      title="Copy the link your payees open to view and download their own receipts"
      className="h-auto rounded-[10px] px-4 py-2.5 text-[14px] font-medium"
    >
      {copied ? (
        <>
          <Check className="mr-1.5 size-3.5 text-success" aria-hidden="true" />
          Copied
        </>
      ) : (
        <>
          <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
          Payment link for your payees
        </>
      )}
    </Button>
  )
}
