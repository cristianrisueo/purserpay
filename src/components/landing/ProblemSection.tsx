import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { problems } from "./content"

export function ProblemSection() {
  return (
    <Section>
      <Eyebrow className="mb-4">the problem</Eyebrow>
      <h2 className="mb-3.5 max-w-[18ch] text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
        Payday shouldn't be the most{" "}
        <span className="text-primary">nerve-wracking</span> hour of your month.
      </h2>
      <p className="mb-[clamp(38px,5vw,56px)] max-w-[52ch] text-[17px] leading-[1.6] text-muted-foreground">
        You run a business, not a treasury desk. Yet every month you become the
        accountant, the data-entry clerk, and the last line of defence — all before
        a single person is paid.
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-5">
        {problems.map((p) => (
          <div
            key={p.n}
            className="rounded-lg border border-border bg-card px-[26px] py-7 shadow-[0_1px_2px_rgba(17,16,20,0.03)]"
          >
            <span className="font-mono text-[11px] tracking-[0.08em] text-primary">
              {p.n}
            </span>
            <h3 className="mt-3.5 mb-2 text-[17px] font-semibold text-foreground">
              {p.title}
            </h3>
            <p className="text-[15px] leading-[1.55] text-muted-foreground">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}
