import { Users } from "lucide-react"

import type { PayeeInput } from "@/lib/payeeValidation"

import { AddPayeeButton } from "./AddPayeeButton"
import { ImportCsvDialog } from "./ImportCsvDialog"

type EmptyRosterProps = {
  rosterCount: number
  onAddPayee: (input: PayeeInput) => Promise<void>
  onImportRoster: (rows: PayeeInput[]) => Promise<void>
}

export function EmptyRoster({
  rosterCount,
  onAddPayee,
  onImportRoster,
}: EmptyRosterProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[14px] border border-border bg-card px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10">
        <Users className="size-5 text-primary" />
      </div>
      <div className="max-w-[42ch]">
        <h2 className="text-[17px] font-semibold text-foreground">
          Your roster is empty
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          Bring in your team from a CSV, or add your first payee by hand.
          Nothing leaves your browser.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-2.5">
        <ImportCsvDialog rosterCount={rosterCount} onImport={onImportRoster} />
        <AddPayeeButton onAdd={onAddPayee} />
      </div>
    </div>
  )
}
