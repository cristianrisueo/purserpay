import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { truncateAddress } from "@/lib/format"
import {
  FIELD_LABELS,
  type ColumnMapping,
  type FieldKey,
  type MappingApplyResult,
  type RawCsvTable,
} from "@/lib/csvImport"

// Radix Select can't hold an empty-string item value, so "no role column" is
// represented by this sentinel here at the JSX boundary only — it's
// translated back to `undefined` before it ever reaches ColumnMapping.
const NO_ROLE = "__none__"
const MAPPING_FIELDS: FieldKey[] = ["name", "address", "amount", "role"]
const PREVIEW_ROW_COUNT = 5

type CsvColumnMapperProps = {
  table: RawCsvTable
  mapping: ColumnMapping
  onMappingChange: (mapping: ColumnMapping) => void
  rosterCount: number
  missingFields: FieldKey[]
  collision: string | null
  mappingResult: MappingApplyResult | null
}

export function CsvColumnMapper({
  table,
  mapping,
  onMappingChange,
  rosterCount,
  missingFields,
  collision,
  mappingResult,
}: CsvColumnMapperProps) {
  const isDestructive = rosterCount > 0

  function setField(field: FieldKey, header: string) {
    if (field === "role" && header === NO_ROLE) {
      const next = { ...mapping }
      delete next.role
      onMappingChange(next)
      return
    }
    onMappingChange({ ...mapping, [field]: header })
  }

  function previewCell(field: FieldKey, row: Record<string, string>) {
    const header = mapping[field]
    const value = header ? (row[header] ?? "") : ""
    if (!value) return <span className="text-muted-foreground">—</span>
    if (field === "address") {
      return (
        <span title={value} className="font-mono">
          {truncateAddress(value)}
        </span>
      )
    }
    return value
  }

  const previewRows = table.rows.slice(0, PREVIEW_ROW_COUNT)
  const extraRowCount = table.rows.length - previewRows.length

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <p className="text-[13.5px] font-medium text-foreground">
          Map your columns
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          We won't guess — tell us which column is which. Columns are listed
          exactly as they appear in your file; repeated names get a number.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {MAPPING_FIELDS.map((field) => (
          <div
            key={field}
            className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
          >
            <label className="text-[13px] font-medium text-foreground sm:w-[104px] sm:shrink-0">
              {FIELD_LABELS[field]}
              {field !== "role" && (
                <span className="text-muted-foreground"> *</span>
              )}
            </label>
            <Select
              value={field === "role" ? (mapping.role ?? NO_ROLE) : mapping[field]}
              onValueChange={(value) => setField(field, value)}
            >
              <SelectTrigger className="w-full sm:flex-1" size="sm">
                <SelectValue placeholder="Choose a column" />
              </SelectTrigger>
              <SelectContent>
                {field === "role" && (
                  <SelectItem value={NO_ROLE}>No role column</SelectItem>
                )}
                {table.headers.map((header) => (
                  <SelectItem key={header} value={header}>
                    {header}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full min-w-[480px] text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 text-right font-medium">USDT amount</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">
                  {previewCell("name", row)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {previewCell("role", row)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {previewCell("address", row)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {previewCell("amount", row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {extraRowCount > 0 && (
          <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground">
            +{extraRowCount} more row{extraRowCount === 1 ? "" : "s"} in the
            file
          </div>
        )}
      </div>

      {missingFields.length > 0 ? (
        <p className="rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px] text-muted-foreground">
          Choose a column for{" "}
          {missingFields.map((f) => FIELD_LABELS[f]).join(", ")} to continue.
        </p>
      ) : collision ? (
        <p className="rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px] text-muted-foreground">
          {collision}
        </p>
      ) : mappingResult && !mappingResult.ok ? (
        <div className="rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px]">
          <p className="font-medium text-foreground">
            These rows need attention:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {mappingResult.errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      ) : mappingResult?.ok ? (
        <p className="rounded-[10px] border border-border bg-muted/30 px-3 py-2.5 text-[13px] font-medium text-foreground">
          Ready to import {mappingResult.rows.length} payee
          {mappingResult.rows.length === 1 ? "" : "s"}
          {isDestructive ? `, replacing your current ${rosterCount}.` : "."}
        </p>
      ) : null}
    </div>
  )
}
