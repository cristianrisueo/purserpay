"use client"

import { useState } from "react"
import Image from "next/image"
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

export function VideoWalkthrough({ label }: { label: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Play the walkthrough"
        className="group relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border bg-bg-band outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        {/* High-fidelity poster frame */}
        <Image
          src="/screen_two.png"
          alt="Walkthrough preview"
          fill
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-cover"
        />
        {/* Soft scrim so the play affordance stays legible over the screenshot. */}
        <span className="absolute inset-0 bg-foreground/15" />

        <span className="relative z-10 flex flex-col items-center gap-3">
          <span className="transition-transform duration-200 group-hover:scale-105">
            <PlayGlyph size="sm" />
          </span>
          <span className="rounded bg-card/85 px-2 py-0.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground backdrop-blur-sm">
            {label}
          </span>
        </span>
      </button>

      <DialogContent
        showCloseButton={false}
        className="w-full max-w-[min(1040px,calc(100%-2rem))] gap-0 overflow-hidden border-0 bg-foreground p-0 sm:max-w-[min(1040px,calc(100%-2rem))]"
      >
        <DialogTitle className="sr-only">
          The walkthrough
        </DialogTitle>

        {/* Live Video Surface */}
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-foreground">
          <video
            src="https://rih9rm0wicuqlghy.public.blob.vercel-storage.com/purserpay_demo.mp4"
            controls
            autoPlay
            preload="metadata"
            playsInline
            className="w-full h-full object-cover"
          />

          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close the walkthrough"
              className="absolute top-3 right-3 z-20 flex size-9 cursor-pointer items-center justify-center rounded-full bg-background/15 text-background outline-none transition-colors hover:bg-background/25 focus-visible:ring-2 focus-visible:ring-background/60"
            >
              <XIcon className="size-4.5" />
            </button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}