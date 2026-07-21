import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { DefenseCards } from "./DefenseCards"
import { PrivacyPanels } from "./PrivacyPanels"
import { ProofBothSides } from "./ProofBothSides"
import { VideoWalkthrough } from "./VideoWalkthrough"
import { modules, type Module } from "./content"

// Bloques 1–4 — the workflow (#how). A single vertical stack of full-width rows, framed by
// clean 1px hairlines (gap-px over the border colour). Every module uses the same rhythm: the
// copy spans the full width on top, with its visual full-width below — a 2×2 grid of the four
// on-chain defenses for 01, the two privacy panels for 02, the two side-by-side proof cards
// (agency + payee) for 03, and the 16:9 walkthrough surface for 04. (The old 50/50 copy-left /
// cards-right shell is retired — Module 02 was its last user.)
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

function moduleKind(m: Module): "video" | "preview" | "defenses" | "privacy" {
  if (m.variant === "video") return "video"
  if (m.variant === "defenses") return "defenses"
  if (m.variant === "privacy") return "privacy"
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

  // Every module uses the same full-width rhythm (owner decision): the copy spans the full width
  // on top, and the visual sits full-width below — the 2×2 four-defense grid for 01, the two
  // privacy panels for 02, the two side-by-side proof cards for 03, and the 16:9 walkthrough
  // surface for 04 (each visual owns its own responsive behaviour).
  return (
    <div className={cell}>
      <ModuleHead module={m} />
      <div className="mt-[clamp(28px,4vw,44px)]">
        {kind === "defenses" ? (
          <DefenseCards />
        ) : kind === "privacy" ? (
          <PrivacyPanels />
        ) : kind === "preview" ? (
          <ProofBothSides />
        ) : (
          <VideoWalkthrough label="Play" />
        )}
      </div>
    </div>
  )
}
