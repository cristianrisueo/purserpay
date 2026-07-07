import { useMemo, useState } from "react"

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
    }
  }

  const validation = useMemo(
    () => validatePayeeShape({ name, role, address, amount }),
    [name, role, address, amount]
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (!validation.ok) return

    setSubmitting(true)
    await onSubmit(validation.value)
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
              placeholder="model"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payee-address">Address</Label>
            <Input
              id="payee-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="T…"
              className="font-mono text-[12.5px]"
            />
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

          {attempted && !validation.ok && (
            <ul className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {validation.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}

          <div className="mt-1 flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={(attempted && !validation.ok) || submitting}
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
