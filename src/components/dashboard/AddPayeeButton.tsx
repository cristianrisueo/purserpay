import { useState } from "react"
import { UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { PayeeInput } from "@/lib/payeeValidation"

import { PayeeFormDialog } from "./PayeeFormDialog"

type AddPayeeButtonProps = {
  onAdd: (input: PayeeInput) => Promise<void>
  variant?: "default" | "outline"
  /** Collapses to an icon-only button below `sm`, matching the wallet chip's
   *  own responsive pattern at 390px. */
  collapseLabel?: boolean
}

export function AddPayeeButton({
  onAdd,
  variant = "default",
  collapseLabel = false,
}: AddPayeeButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant={variant}
        onClick={() => setOpen(true)}
        className="h-auto rounded-[10px] px-4 py-3 text-[14px] font-medium"
        aria-label="Add payee"
      >
        <UserPlus />
        <span className={collapseLabel ? "hidden sm:inline" : undefined}>
          Add payee
        </span>
      </Button>

      <PayeeFormDialog
        mode="add"
        open={open}
        onOpenChange={setOpen}
        onSubmit={onAdd}
      />
    </>
  )
}
