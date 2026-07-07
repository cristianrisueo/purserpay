import { useRef, useState } from "react"

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
import { parseRosterCsv } from "@/lib/csvImport"
import type { PayeeInput } from "@/lib/payeeValidation"

type ImportCsvDialogProps = {
  rosterCount: number
  onImport: (rows: PayeeInput[]) => Promise<void>
}

type Stage =
  | { kind: "idle" }
  | { kind: "error"; errors: string[] }
  | { kind: "ready"; rows: PayeeInput[] }

export function ImportCsvDialog({ rosterCount, onImport }: ImportCsvDialogProps) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isDestructive = rosterCount > 0

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setStage({ kind: "idle" })
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = parseRosterCsv(text)
    setStage(
      result.ok
        ? { kind: "ready", rows: result.rows }
        : { kind: "error", errors: result.errors }
    )
  }

  async function handleConfirm() {
    if (stage.kind !== "ready") return
    setImporting(true)
    await onImport(stage.rows)
    setImporting(false)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <DialogTitle>Import your roster</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {isDestructive
              ? `Importing a CSV replaces your current roster of ${rosterCount} payee${rosterCount === 1 ? "" : "s"}. `
              : "Bring your team in from a CSV. "}
            Expects columns: name, address, amount — role optional.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30">
          <span className="text-[14px] font-medium text-foreground">
            Click to choose a CSV file
          </span>
          <span className="text-[12.5px] text-muted-foreground">.csv</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={handleFile}
          />
        </label>

        {stage.kind === "error" && (
          <div className="rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px]">
            <p className="font-medium text-foreground">
              Couldn't read this file:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {stage.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {stage.kind === "ready" && (
          <div className="rounded-[10px] border border-border bg-muted/30 px-3 py-2.5 text-[13px]">
            <p className="font-medium text-foreground">
              Ready to import {stage.rows.length} payee
              {stage.rows.length === 1 ? "" : "s"}
              {isDestructive ? `, replacing your current ${rosterCount}.` : "."}
            </p>
            <p className="mt-1 truncate text-muted-foreground">
              {stage.rows
                .slice(0, 4)
                .map((r) => r.name)
                .join(", ")}
              {stage.rows.length > 4 ? `, +${stage.rows.length - 4} more` : ""}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" className="flex-1">
              Cancel
            </Button>
          </DialogClose>
          {stage.kind === "ready" && (
            <Button
              type="button"
              variant={isDestructive ? "destructive" : "default"}
              disabled={importing}
              onClick={handleConfirm}
              className="flex-1"
            >
              {isDestructive ? "Replace roster" : "Import roster"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
