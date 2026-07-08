import { TriangleAlert } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type OfacBlockedDialogProps = {
  /** The flagged recipient addresses; the dialog is open while this is non-null. */
  flagged: string[] | null
  onDismiss: () => void
}

export function OfacBlockedDialog({ flagged, onDismiss }: OfacBlockedDialogProps) {
  const count = flagged?.length ?? 0
  const one = count === 1

  return (
    <AlertDialog
      open={flagged != null}
      onOpenChange={(o) => {
        if (!o) onDismiss()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {one ? "A recipient is sanctioned" : "Recipients are sanctioned"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {one ? "One address" : `${count} addresses`} on this payout {one ? "matches" : "match"} the
            OFAC sanctions list. The whole batch is blocked — nobody was paid.
            Remove {one ? "it" : "them"} from your roster to continue.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {flagged?.map((address) => (
            <li
              key={address}
              className="rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-[12.5px] break-all text-destructive"
            >
              {address}
            </li>
          ))}
        </ul>

        <AlertDialogFooter className="mx-0 mb-0 flex-row gap-2 border-t-0 bg-transparent p-0">
          <AlertDialogAction className="flex-1">Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
