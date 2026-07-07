import { cn } from "@/lib/utils"

// A full-width section band with a centered max-width container.
// `band` paints the alternating warm background (#F1EFEC) with hairline borders.
// Vertical rhythm and any container-width override come through `className`.
export function Section({
  id,
  band = false,
  className,
  children,
}: {
  id?: string
  band?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-20", band && "border-y border-border bg-bg-band")}
    >
      <div
        className={cn(
          "mx-auto w-full max-w-[1160px] px-8 py-[clamp(60px,8vw,104px)]",
          className
        )}
      >
        {children}
      </div>
    </section>
  )
}
