import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { features } from "./content"

export function FeaturesSection() {
  return (
    <Section band>
      <Eyebrow className="mb-4">what you get</Eyebrow>
      <h2 className="mb-[clamp(38px,5vw,56px)] max-w-[18ch] text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
        Six things that make payday <span className="text-primary">boring.</span>
      </h2>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-lg border border-border bg-card px-7 py-[30px]"
          >
            <h3 className="mb-2.5 text-[18px] font-semibold text-foreground">
              {feature.title}
            </h3>
            <p className="text-[15px] leading-[1.6] text-muted-foreground">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}
