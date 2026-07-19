"use client"

import dynamic from "next/dynamic"

// The affiliate portal is client-only: it reads the injected TronLink wallet and signs
// a challenge, neither of which exists during SSR (tronweb can't be evaluated on the
// server — same reason the dashboard uses ssr:false). This keeps tron/* out of the
// server render graph.
//
// ONE fixed route for every affiliate — NO code in the URL, NO cookies. Identity comes
// from the SIGNATURE (resolved to hash(signer) server-side), never from the link. A
// pasted wallet renders nothing because there is no wallet-addressable route at all.
const AffiliatePortal = dynamic(
  () => import("@/components/portal/AffiliatePortal").then((m) => m.AffiliatePortal),
  { ssr: false }
)

export default function PortalPage() {
  return <AffiliatePortal />
}
