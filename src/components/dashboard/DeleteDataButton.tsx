import { useState } from "react"

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

type DeleteDataButtonProps = {
  onDelete: () => Promise<void>
}

// A destructive footer control that wipes ALL device-local data — the entire roster
// and the full payment history — after an explicit confirm (same AlertDialog pattern
// as the per-row Remove). Device-local only: the account's encrypted PII and the
// on-chain subscription live elsewhere and are untouched.
export function DeleteDataButton({ onDelete }: DeleteDataButtonProps) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    await onDelete()
    setDeleting(false)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setOpen(true)}
        className="h-auto rounded-[10px] px-4 py-2.5 text-[14px] font-medium"
      >
        Delete data
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
            <AlertDialogDescription>
              This erases your entire roster and payment history from this device —
              permanently, and it can't be undone. Your subscription and the payouts
              already settled on-chain aren't affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mx-0 mb-0 flex-row gap-2 border-t-0 bg-transparent p-0">
            <AlertDialogCancel className="flex-1">Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              className="flex-1"
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
            >
              Delete data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
