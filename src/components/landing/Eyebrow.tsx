import { cn } from "@/lib/utils"

// Small monospace section label in aqua (e.g. "the problem", "how it works").
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-block font-mono text-[11px] tracking-[0.16em] text-primary",
        className
      )}
    >
      {children}
    </span>
  )
}
