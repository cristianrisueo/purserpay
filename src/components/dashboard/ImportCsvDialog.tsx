import { useMemo, useRef, useState } from "react"

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
import {
  applyMapping,
  describeMappingCollision,
  parseCsvTable,
  type ColumnMapping,
  type FieldKey,
  type RawCsvTable,
} from "@/lib/csvImport"
import type { PayeeInput } from "@/lib/payeeValidation"
import type { RowConflictGroup } from "@/lib/rosterDedupe"

import { CsvColumnMapper } from "./CsvColumnMapper"

type ImportCsvDialogProps = {
  rosterCount: number
  onImport: (
    rows: PayeeInput[],
    conflictGroups?: RowConflictGroup<PayeeInput>[]
  ) => Promise<void>
}

type Stage = "pick" | "map"

const REQUIRED_FIELDS: FieldKey[] = ["name", "address", "amount"]
const FILE_INPUT_ID = "import-csv-file-input"

export function ImportCsvDialog({ rosterCount, onImport }: ImportCsvDialogProps) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>("pick")
  const [fileName, setFileName] = useState("")
  const [table, setTable] = useState<RawCsvTable | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [fileError, setFileError] = useState<string[] | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isDestructive = rosterCount > 0

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setStage("pick")
      setFileName("")
      setTable(null)
      setMapping({})
      setFileError(null)
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // Serves both the initial dropzone and "Choose a different file" — always
  // resets the mapping (a mapping keyed to file A's headers is meaningless
  // against file B's) and can move the stage backward to "pick" if the newly
  // chosen file fails to parse, so the flow isn't strictly forward-only.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = parseCsvTable(text)
    setMapping({})
    if (result.ok) {
      setTable(result.table)
      setFileName(file.name)
      setFileError(null)
      setStage("map")
    } else {
      setTable(null)
      setFileError(result.errors)
      setStage("pick")
    }
  }

  const missingFields = useMemo(
    () => REQUIRED_FIELDS.filter((f) => !mapping[f]),
    [mapping]
  )
  const collision = useMemo(() => describeMappingCollision(mapping), [mapping])
  const mappingResult = useMemo(() => {
    if (!table || missingFields.length > 0 || collision) return null
    return applyMapping(table, mapping)
  }, [table, mapping, missingFields, collision])

  async function handleConfirm() {
    // Bail only with nothing to do — no uniques to write AND no conflicts to resolve.
    // (Previously we bailed on `rows.length === 0` alone; now an all-conflict file still
    // proceeds, because the user can resolve those in the resolver — UX-3.)
    if (
      !mappingResult?.ok ||
      (mappingResult.rows.length === 0 && mappingResult.conflictGroups.length === 0)
    )
      return
    setImporting(true)
    // Uniques land immediately; conflictGroups (if any) open the Dashboard-root resolver.
    await onImport(mappingResult.rows, mappingResult.conflictGroups)
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
      <DialogContent className={stage === "map" ? "sm:max-w-2xl" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>Import your roster</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {stage === "pick" ? (
              <>
                {isDestructive
                  ? `Importing a CSV replaces your current roster of ${rosterCount} payee${rosterCount === 1 ? "" : "s"}. `
                  : "Bring your team in from a CSV. "}
                Use whatever columns your file already has — you'll match them
                up next.
              </>
            ) : (
              "Match your file's columns below, then continue."
            )}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          id={FILE_INPUT_ID}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={handleFile}
        />

        {stage === "pick" && (
          <>
            <label
              htmlFor={FILE_INPUT_ID}
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <span className="text-[14px] font-medium text-foreground">
                Click to choose a CSV file
              </span>
              <span className="text-[12.5px] text-muted-foreground">.csv</span>
            </label>

            {fileError && (
              <div className="rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px]">
                <p className="font-medium text-foreground">
                  Couldn't read this file:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {fileError.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {stage === "map" && table && (
          <>
            <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
              <span className="truncate">File: {fileName}</span>
              <button
                type="button"
                className="shrink-0 font-medium text-primary hover:underline"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose a different file
              </button>
            </div>

            <CsvColumnMapper
              table={table}
              mapping={mapping}
              onMappingChange={setMapping}
              rosterCount={rosterCount}
              missingFields={missingFields}
              collision={collision}
              mappingResult={mappingResult}
            />
          </>
        )}

        <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" className="flex-1">
              Cancel
            </Button>
          </DialogClose>
          {stage === "map" && (
            <Button
              type="button"
              variant={isDestructive ? "destructive" : "default"}
              disabled={
                !mappingResult?.ok ||
                (mappingResult.rows.length === 0 &&
                  mappingResult.conflictGroups.length === 0) ||
                importing
              }
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
