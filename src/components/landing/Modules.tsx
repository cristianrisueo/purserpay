import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { ProofBothSides } from "./ProofBothSides"
import { VideoWalkthrough } from "./VideoWalkthrough"
import { modules, type Module } from "./content"

// Bloques 1–4 — the workflow (#how). A single vertical stack of full-width rows,
// framed by clean 1px hairlines (gap-px over the border colour). Modules 01/02 and 04
// keep a symmetric 50/50 rhythm on desktop — copy on the left, the visual on the right
// (the pair of check cards for 01–02, a 16:9 walkthrough thumbnail for 04). Module 03
// breaks that rhythm (owner decision): its copy spans the full width on top, with the
// two proof cards — the agency view and the payee view — side by side below.
export function Modules() {
  return (
    <Section id="how" band>
      <Eyebrow className="mb-4">how it works</Eyebrow>
      <h2 className="mb-[clamp(38px,5vw,56px)] max-w-[18ch] text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
        The engine, in <span className="text-primary">four parts.</span>
      </h2>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-1 gap-px bg-border">
          {modules.map((m) => (
            <ModuleCell key={m.n} module={m} />
          ))}
        </div>
      </div>
    </Section>
  )
}

function moduleKind(m: Module): "points" | "video" | "preview" {
  if (m.variant === "video") return "video"
  if (m.points) return "points"
  return "preview"
}

function ModuleHead({ module: m }: { module: Module }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[12px] font-semibold text-primary">
          {m.n}
        </span>
        <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
          {m.eyebrow}
        </span>
      </div>
      <h3 className="mt-4 mb-2.5 text-[19px] font-semibold text-foreground">
        {m.title}
      </h3>
      <p className="max-w-[56ch] text-[15.5px] leading-[1.6] text-muted-foreground">
        {m.body}
      </p>
    </>
  )
}

function ModuleCell({ module: m }: { module: Module }) {
  const kind = moduleKind(m)
  const cell = "bg-card p-[clamp(24px,3.2vw,36px)]"

  // Module 03 (preview) breaks the 50/50 rhythm by owner decision: the copy spans the
  // full width on top, and the two proof cards (agency + payee) sit side by side below
  // (stacking on narrow screens — handled inside ProofBothSides).
  if (kind === "preview") {
    return (
      <div className={cell}>
        <ModuleHead module={m} />
        <div className="mt-[clamp(28px,4vw,44px)]">
          <ProofBothSides />
        </div>
      </div>
    )
  }

  // Modules 01/02 (points) and 04 (video): the symmetric 50/50 shell — copy left, visual
  // right on desktop. Points carry an optional marker: ✓ (single), ✓✓ (paid-before), or
  // none for a descriptive property that isn't a verification status.
  return (
    <div className={cell}>
      <div className="grid grid-cols-1 items-center gap-[clamp(28px,4vw,56px)] md:grid-cols-2">
        <div>
          <ModuleHead module={m} />
        </div>

        {kind === "video" ? (
          <VideoWalkthrough label="Play" />
        ) : (
          m.points && (
            <div className="grid grid-cols-1 gap-4">
              {m.points.map((p) => (
                <div
                  key={p.label}
                  className="rounded-lg border border-border bg-bg-band px-4 py-3.5"
                >
                  <div className="mb-1.5 flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
                    {p.check && (
                      <span className="font-bold text-primary">
                        {p.check === "double" ? "✓✓" : "✓"}
                      </span>
                    )}
                    {p.label}
                  </div>
                  <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
