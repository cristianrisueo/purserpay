import { cn } from "@/lib/utils"

type LogoProps = {
  /** Size via className, e.g. `size-6` / `h-6 w-6`. Defaults to `size-6`. */
  className?: string
  /**
   * Render the full app-icon: an ink rounded tile with the framed glyph inside
   * (for favicons / app icons). Off (default) renders the bare aqua glyph with a
   * tightened viewBox, for inline/header use next to the wordmark.
   */
  tile?: boolean
  /** Accessible label. Omit to render the mark decoratively (aria-hidden). */
  title?: string
}

// The Purser mark: a geometric "P" (the purser's ledger) with two payment-flow
// lines beneath it (the batch payout). On-palette — the accent is the brand aqua
// via `currentColor` (default `text-primary`), so a caller can recolor it (e.g.
// `text-foreground` in a footer) and it stays in sync if the token ever moves.
// The two flow lines are large-format detail; below ~24px only the "P" reads,
// which is the intended small-size behaviour.
export function Logo({ className, tile = false, title }: LogoProps) {
  const a11y = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const }

  const glyph = (
    <>
      <path
        d="M170 130V370M170 130H290C345 130 345 230 290 230H170"
        strokeWidth={28}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M210 290H310" strokeWidth={16} strokeLinecap="round" strokeOpacity={0.9} />
      <path d="M210 330H280" strokeWidth={16} strokeLinecap="round" strokeOpacity={0.55} />
    </>
  )

  if (tile) {
    return (
      <svg
        viewBox="0 0 500 500"
        className={cn("size-6 text-primary", className)}
        fill="none"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
        {...a11y}
      >
        {title ? <title>{title}</title> : null}
        {/* Ink app-icon tile (light-only app, so the tile is always ink). */}
        <rect width="500" height="500" rx="112" fill="#111014" />
        {/* Aqua frame + glyph */}
        <g stroke="currentColor">
          <rect
            x="50"
            y="50"
            width="400"
            height="400"
            rx="80"
            strokeWidth={12}
            strokeOpacity={0.85}
          />
          {glyph}
        </g>
      </svg>
    )
  }

  // Inline glyph — no tile, no frame, viewBox tightened to the glyph bounds so
  // it optically matches the wordmark cap-height when set beside it.
  return (
    <svg
      viewBox="140 108 220 284"
      className={cn("size-6 text-primary", className)}
      fill="none"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <g stroke="currentColor">{glyph}</g>
    </svg>
  )
}
