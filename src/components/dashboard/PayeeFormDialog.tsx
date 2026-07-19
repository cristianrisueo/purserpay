import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { lastChars } from "@/lib/format"
import { validatePayeeShape, type PayeeInput } from "@/lib/payeeValidation"
import type { Payee } from "@/lib/roster"

type PayeeFormDialogProps = {
  mode: "add" | "edit"
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValue?: Payee
  onSubmit: (input: PayeeInput) => Promise<void>
}

export function PayeeFormDialog({
  mode,
  open,
  onOpenChange,
  initialValue,
  onSubmit,
}: PayeeFormDialogProps) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  const [address, setAddress] = useState("")
  const [amount, setAmount] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Anti clipboard-malware: a freshly entered / changed address must be visually confirmed (its
  // last 6 chars) before it can be saved. PurserPay pays FROM the roster, so a corrupted paste
  // caught here never becomes a payout. Not required when an edit keeps its own address.
  const [confirmedAddress, setConfirmedAddress] = useState(false)
  // A rejection raised while persisting (e.g. the roster's duplicate-address
  // guard) — shape-valid, so it can't be caught by `validation`. Surfaced in
  // the same red box as validation errors.
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset the form fields whenever the dialog transitions to open — an
  // "adjusting state during render" derivation, not an effect, so it can't
  // trigger the cascading-render issue useEffect-based resets are prone to.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(initialValue?.name ?? "")
      setRole(initialValue?.role ?? "")
      setAddress(initialValue?.address ?? "")
      setAmount(initialValue ? String(initialValue.amount) : "")
      setAttempted(false)
      setSubmitting(false)
      setSubmitError(null)
      setConfirmedAddress(false)
    }
  }

  const validation = useMemo(
    () => validatePayeeShape({ name, role, address, amount }),
    [name, role, address, amount]
  )

  // Confirmation is required only for a NEW or CHANGED address (editing just the amount asks
  // nothing). On add, the initial address is empty, so any address entered needs confirming.
  const addressChanged = address.trim() !== "" && address !== (initialValue?.address ?? "")
  const confirmBlocked = addressChanged && !confirmedAddress

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    setSubmitError(null)
    if (!validation.ok) return
    // The visible checkbox is the affordance; guard the Enter-key path too.
    if (confirmBlocked) return

    setSubmitting(true)
    try {
      await onSubmit(validation.value)
    } catch (err) {
      // A persist-time rejection (duplicate address) — keep the dialog open and
      // show why, exactly like a validation error.
      setSubmitError(err instanceof Error ? err.message : "Couldn't save this payee.")
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add a payee" : "Edit payee"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "They'll join your roster checked and ready for the next payout."
              : "Changes save to your roster immediately."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payee-name">Name</Label>
            <Input
              id="payee-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Luna"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payee-role">
              Role{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="payee-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="editor"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payee-address">Address</Label>
            <Input
              id="payee-address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                // The dedupe error is about this field — clear it as they retype.
                if (submitError) setSubmitError(null)
                // Any address edit invalidates a prior confirmation.
                setConfirmedAddress(false)
              }}
              placeholder="T…"
              className="font-mono text-[12.5px]"
            />
            {addressChanged ? (
              <label className="mt-0.5 flex items-start gap-2.5 rounded-[10px] border border-border bg-muted/40 px-3 py-2">
                <Checkbox
                  checked={confirmedAddress}
                  onCheckedChange={(v) => setConfirmedAddress(v === true)}
                  className="mt-0.5"
                  aria-label="Confirm the recipient address is correct"
                />
                <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Ends in{" "}
                  <span className="font-mono font-semibold text-foreground">
                    …{lastChars(address, 6)}
                  </span>{" "}
                  — check this matches what your payee sent. I confirm it&apos;s correct.
                </span>
              </label>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payee-amount">USDT amount</Label>
            <Input
              id="payee-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="1,200"
            />
          </div>

          {attempted && !validation.ok ? (
            <ul className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {validation.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : submitError ? (
            <p className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {submitError}
            </p>
          ) : null}

          <div className="mt-1 flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={(attempted && !validation.ok) || submitting || confirmBlocked}
              className="flex-1"
            >
              {mode === "add" ? "Add payee" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
