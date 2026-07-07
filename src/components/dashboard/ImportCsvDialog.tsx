import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// Honest stub: opens a dialog that plainly says roster import lands in the next
// build. It fakes no parsing and touches no data — the table runs on a sample team.
export function ImportCsvDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto rounded-[10px] px-4 py-3 text-[14px] font-medium"
        >
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Roster import is coming next</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Bringing your own team in from a CSV arrives with the roster step —
            the next build. For now the table runs on a sample team so you can
            try the whole payout flow end to end.
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button variant="outline" className="mt-1 w-full">
            Got it
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
