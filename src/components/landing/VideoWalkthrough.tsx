"use client"

import { useState } from "react"
import { XIcon } from "lucide-react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"

// A small play glyph — a right-pointing triangle drawn with borders so it needs
// no asset. `scale` lets the same mark read at thumbnail and lightbox sizes.
function PlayGlyph({ size }: { size: "sm" | "lg" }) {
  const ring =
    size === "lg"
      ? "size-20 shadow-[0_2px_10px_rgba(17,16,20,0.18)]"
      : "size-14 shadow-[0_1px_2px_rgba(17,16,20,0.06)]"
  const tri =
    size === "lg"
      ? "border-y-[13px] border-l-[21px]"
      : "border-y-[9px] border-l-[15px]"
  return (
    <span
      className={`flex ${ring} items-center justify-center rounded-full border border-border bg-card`}
    >
      <span
        className={`ml-1 ${tri} border-y-transparent border-l-primary`}
      />
    </span>
  )
}

// Module 04's right column. A compact 16:9 thumbnail that reads as a play
// affordance; clicking it opens a centered lightbox with the large player
// (no inline playback). The player surface is a structural placeholder until
// the real recording is dropped in — swap the marked <div> for a <video> /
// <iframe> when the file exists. Kept as its own client island so the rest of
// the Modules section stays a server component.
export function VideoWalkthrough({ label }: { label: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Play the five-minute walkthrough"
        className="group flex aspect-video w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-band outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <span className="flex flex-col items-center gap-3 text-muted-foreground">
          <span className="transition-transform duration-200 group-hover:scale-105">
            <PlayGlyph size="sm" />
          </span>
          <span className="font-mono text-[11px] tracking-[0.12em]">
            {label}
          </span>
        </span>
      </button>

      <DialogContent
        showCloseButton={false}
        className="w-full max-w-[min(1040px,calc(100%-2rem))] gap-0 overflow-hidden border-0 bg-foreground p-0 sm:max-w-[min(1040px,calc(100%-2rem))]"
      >
        <DialogTitle className="sr-only">
          The five-minute walkthrough
        </DialogTitle>

        {/* Structural player surface — replace with the real <video>/<iframe>
            once the recording ships. */}
        <div className="relative flex aspect-video w-full items-center justify-center bg-foreground">
          <span className="flex flex-col items-center gap-4 text-background/80">
            <PlayGlyph size="lg" />
            <span className="font-mono text-[12px] tracking-[0.14em]">
              {label}
            </span>
          </span>

          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close the walkthrough"
              className="absolute top-3 right-3 flex size-9 cursor-pointer items-center justify-center rounded-full bg-background/15 text-background outline-none transition-colors hover:bg-background/25 focus-visible:ring-2 focus-visible:ring-background/60"
            >
              <XIcon className="size-4.5" />
            </button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
