import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BillingPii, SubscribePhase } from "@/hooks/usePayout"
import { SUBSCRIPTION_PRICE_USDT } from "@/lib/tron/config"
import type { PurserError } from "@/lib/tron/errors"

type SubscribeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubscribe: (pii: BillingPii) => Promise<void>
  phase: SubscribePhase
  error: PurserError | null
  networkName: string
  /** Plan price in whole USDT (150 monthly / 1,500 annual). Defaults to monthly so
   *  the dashboard paywall caller stays unchanged. */
  priceUsdt?: number
  /** Cadence word for the copy ("a month" / "a year"). Defaults to monthly. */
  periodLabel?: string
}

/** Button content per phase. The on-chain settle (approve/sign/confirm) shows one
 *  "Settling on-chain…" spinner; only after it confirms does "storing" show "Saving
 *  your details…" while the PII is persisted. Idle shows the submit label. */
function submitContent(
  phase: SubscribePhase,
): { text: string; spinning: boolean } {
  switch (phase) {
    case "storing":
      return { text: "Saving your details…", spinning: true }
    case "approving":
    case "signing":
    case "confirming":
      return { text: "Settling on-chain…", spinning: true }
    default:
      return { text: `Confirm and pay`, spinning: false }
  }
}

export function SubscribeDialog({
  open,
  onOpenChange,
  onSubscribe,
  phase,
  error,
  networkName,
  priceUsdt = SUBSCRIPTION_PRICE_USDT,
  periodLabel = "a month",
}: SubscribeDialogProps) {
  const [name, setName] = useState("")
  const [country, setCountry] = useState("")
  const [taxId, setTaxId] = useState("")
  const [attempted, setAttempted] = useState(false)

  // Reset the form whenever the dialog transitions to open — a render-time
  // derivation (not an effect), matching PayeeFormDialog, so it can't cascade.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName("")
      setCountry("")
      setTaxId("")
      setAttempted(false)
    }
  }

  const trimmed = {
    name: name.trim(),
    country: country.trim(),
    taxId: taxId.trim(),
  }
  const errors: string[] = []
  if (!trimmed.name) errors.push("Enter your legal name.")
  if (!trimmed.country) errors.push("Enter your country.")
  if (!trimmed.taxId) errors.push("Enter your tax ID.")
  const ok = errors.length === 0

  const busy = phase !== "idle"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (!ok || busy) return
    // The hook closes this dialog on success (after re-reading the gate) and
    // surfaces `error` on failure; we never persist the PII locally.
    await onSubscribe(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activate your subscription</DialogTitle>
          <DialogDescription>
            PurserPay is {priceUsdt} USDT {periodLabel}, paid on-chain from your
            own wallet. Enter your billing details to continue — they're encrypted
            and stored apart from your payouts.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sub-name">Legal name</Label>
            <Input
              id="sub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Rivera"
              autoFocus
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sub-country">Country</Label>
            <Input
              id="sub-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Portugal"
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sub-tax-id">Tax ID</Label>
            <Input
              id="sub-tax-id"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="PT123456789"
              disabled={busy}
            />
          </div>

          {error ? (
            <p className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {error.message}
            </p>
          ) : attempted && !ok ? (
            <ul className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : busy ? (
            <p className="text-[12.5px] text-muted-foreground">
              Keep this window open until it confirms.
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              One signature, paid from your connected wallet on {networkName}.
              Purser never holds your funds.
            </p>
          )}

          <div className="mt-1 flex gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={busy}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={(attempted && !ok) || busy}
              className="min-w-0 flex-1 whitespace-normal"
            >
              {(() => {
                const { text, spinning } = submitContent(phase)
                return (
                  <>
                    {spinning ? (
                      <Loader2
                        className="mr-2 size-4 shrink-0 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {text}
                  </>
                )
              })()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
