"use client"

// Fire-and-forget client caller: report a just-confirmed disperse txid so the server
// can index it into the affiliate receipt store (going forward). It POSTs ONLY the
// public txid — the server re-verifies and decodes the tx on-chain itself, never
// trusting anything else.
//
// BEST-EFFORT by design: the payout has already succeeded on-chain, so a recording
// hiccup must NEVER surface to the user or block anything. The caller wraps this in
// `void recordDisperse(txid).catch(() => {})`, exactly like the device-local addReceipt.

export async function recordDisperse(txid: string): Promise<void> {
  try {
    await fetch("/api/affiliate/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txid }),
    })
  } catch {
    /* best-effort — a lost recording only delays a receipt appearing, never the pay */
  }
}
