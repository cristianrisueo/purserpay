import { useState } from "react"
import { EllipsisVertical } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { Payee } from "@/lib/roster"

import { PayeeFormDialog } from "./PayeeFormDialog"

type RosterRowActionsProps = {
  payee: Payee
  disabled: boolean
  onUpdate: (id: string, input: PayeeInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

export function RosterRowActions({
  payee,
  disabled,
  onUpdate,
  onRemove,
}: RosterRowActionsProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function handleRemove() {
    setRemoving(true)
    await onRemove(payee.id)
    setRemoving(false)
    setRemoveOpen(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Actions for ${payee.name}`}
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setRemoveOpen(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PayeeFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        initialValue={payee}
        onSubmit={(input) => onUpdate(payee.id, input)}
      />

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {payee.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes them from your roster — they won't be back next
              cycle either. This isn't the same as unchecking them for this
              month.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mx-0 mb-0 flex-row gap-2 border-t-0 bg-transparent p-0">
            <AlertDialogCancel className="flex-1">Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              className="flex-1"
              onClick={(e) => {
                e.preventDefault()
                handleRemove()
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
