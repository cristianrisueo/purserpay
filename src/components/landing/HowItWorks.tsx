import { cn } from "@/lib/utils"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { steps } from "./content"

export function HowItWorks() {
  return (
    <Section id="how" band>
      <Eyebrow className="mb-4">how it works</Eyebrow>
      <h2 className="mb-[clamp(38px,5vw,56px)] max-w-[16ch] text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
        Three steps. Then you're <span className="text-primary">done.</span>
      </h2>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
        {steps.map((step) => (
          <div
            key={step.n}
            className={cn(
              "rounded-lg border bg-card px-7 py-8",
              step.highlight
                ? "border-primary shadow-[0_12px_30px_-20px_rgba(15,181,201,0.4)]"
                : "border-border"
            )}
          >
            <div
              className={cn(
                "mb-5 flex size-[38px] items-center justify-center rounded-[9px] text-[15px] font-bold",
                step.highlight
                  ? "bg-primary/10 text-primary"
                  : "bg-bg-band text-foreground"
              )}
            >
              {step.n}
            </div>
            <h3
              className={cn(
                "mb-2.5 text-[19px] font-semibold",
                step.highlight ? "text-primary" : "text-foreground"
              )}
            >
              {step.title}
            </h3>
            <p className="text-[15.5px] leading-[1.6] text-muted-foreground">
              {step.body}
              {step.strongTail && (
                <b className="text-foreground">{step.strongTail}</b>
              )}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}
