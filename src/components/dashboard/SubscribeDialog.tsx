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
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BillingPii, SubscribePhase } from "@/hooks/usePayout"
import {
  SUBSCRIPTION_PRICE_ANNUAL_USDT,
  SUBSCRIPTION_PRICE_USDT,
  type SubscriptionPlan,
} from "@/lib/tron/config"
import type { PurserError } from "@/lib/tron/errors"

type SubscribeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubscribe: (pii: BillingPii, plan: SubscriptionPlan) => Promise<void>
  phase: SubscribePhase
  error: PurserError | null
  networkName: string
  /** Which plan the selector opens on. Dashboard paywall passes 0 (monthly, the
   *  deliberate default for an irreversible payment); the landing passes the plan
   *  the user already picked in the pricing cards. Defaults to monthly. */
  defaultPlan?: SubscriptionPlan
}

/** The two on-chain plans, priced from config (never hardcoded). 30/365-day period
 *  labels mirror the contract's SUBSCRIPTION_PERIOD / _ANNUAL and the landing cards. */
const PLAN_OPTIONS: {
  plan: SubscriptionPlan
  name: string
  priceUsdt: number
  period: string
  badge?: string
}[] = [
  { plan: 0, name: "Monthly", priceUsdt: SUBSCRIPTION_PRICE_USDT, period: "30 days" },
  {
    plan: 1,
    name: "Annual",
    priceUsdt: SUBSCRIPTION_PRICE_ANNUAL_USDT,
    period: "365 days",
    badge: "best value",
  },
]

/** Button content per phase. The on-chain settle (approve/sign/confirm) shows one
 *  "Settling on-chain…" spinner; only after it confirms does "storing" show "Saving
 *  your details…" while the PII is persisted. Idle shows the submit label. */
function submitContent(
  phase: SubscribePhase,
): { text: string; spinning: boolean } {
  switch (phase) {
    case "storing":
      return { text: "Saving your details…", spinning: true }
    case "resetting":
      // Mainnet USDT needs a standing approval cleared to 0 first — a distinct,
      // extra signature. Name it so the second prompt isn't a surprise (Law #2).
      return { text: "Clearing previous approval…", spinning: true }
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
  defaultPlan = 0,
}: SubscribeDialogProps) {
  const [name, setName] = useState("")
  const [country, setCountry] = useState("")
  const [taxId, setTaxId] = useState("")
  const [plan, setPlan] = useState<SubscriptionPlan>(defaultPlan)
  const [attempted, setAttempted] = useState(false)

  // Reset the form (and the plan, back to defaultPlan) whenever the dialog
  // transitions to open — a render-time derivation (not an effect), matching
  // PayeeFormDialog, so it can't cascade.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName("")
      setCountry("")
      setTaxId("")
      setPlan(defaultPlan)
      setAttempted(false)
    }
  }

  // Price + cadence follow the selected plan, read from config (never hardcoded).
  const priceUsdt =
    plan === 1 ? SUBSCRIPTION_PRICE_ANNUAL_USDT : SUBSCRIPTION_PRICE_USDT
  const periodLabel = plan === 1 ? "a year" : "a month"

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
    // surfaces `error` on failure; we never persist the PII locally. The selected
    // plan is passed through to runSubscribe.
    await onSubscribe(trimmed, plan)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activate your subscription</DialogTitle>
          <DialogDescription>
            PurserPay is {priceUsdt.toLocaleString("en-US")} USDT {periodLabel},
            paid on-chain from your own wallet. Enter your billing details to
            continue — they're encrypted and stored apart from your payouts.
          </DialogDescription>
        </DialogHeader>

        {/* Plan selector — a two-option toggle mirroring the landing pricing cards.
            The displayed price/cadence above follows the selection; the chosen plan
            is what gets signed. Locked while a subscription is settling. */}
        <div
          role="radiogroup"
          aria-label="Subscription plan"
          className="grid grid-cols-2 gap-2"
        >
          {PLAN_OPTIONS.map((opt) => {
            const active = plan === opt.plan
            return (
              <button
                key={opt.plan}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => setPlan(opt.plan)}
                className={cn(
                  "rounded-[10px] border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-primary bg-primary/[0.04] ring-1 ring-inset ring-primary"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {opt.name}
                  </span>
                  {opt.badge ? (
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {opt.badge}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 text-[15px] font-semibold tabular-nums text-foreground">
                  {opt.priceUsdt.toLocaleString("en-US")} USDT
                </div>
                <div className="text-[12px] text-muted-foreground">
                  per {opt.period}
                </div>
              </button>
            )
          })}
        </div>

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
          ) : phase === "resetting" ? (
            <p className="text-[12.5px] text-muted-foreground">
              Clearing your previous approval first — one extra signature.
            </p>
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
