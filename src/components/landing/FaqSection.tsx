"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Section } from "./Section"
import { Eyebrow } from "./Eyebrow"
import { faqs } from "./content"

export function FaqSection() {
  return (
    <Section id="faq" band className="max-w-[820px]">
      <Eyebrow className="mb-4">straight answers</Eyebrow>
      <h2 className="mb-[clamp(34px,5vw,48px)] text-[clamp(1.9rem,4vw,2.9rem)] font-bold leading-[1.06] tracking-[-0.025em] text-foreground">
        Questions, answered <span className="text-primary">plainly.</span>
      </h2>

      <Accordion
        type="single"
        collapsible
        defaultValue="item-0"
        className="border-t border-border"
      >
        {faqs.map((faq, i) => (
          <AccordionItem
            key={faq.q}
            value={`item-${i}`}
            className="border-b border-border"
          >
            <AccordionTrigger className="items-center py-[22px] text-[clamp(16.5px,2vw,19px)] font-semibold text-foreground hover:no-underline [&_[data-slot=accordion-trigger-icon]]:hidden">
              {faq.q}
              <span
                aria-hidden
                className="ml-auto flex-none text-[22px] leading-none font-normal text-primary"
              >
                <span className="group-data-[state=open]/accordion-trigger:hidden">
                  +
                </span>
                <span className="hidden group-data-[state=open]/accordion-trigger:inline">
                  –
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-0 pb-[26px]">
              <p className="max-w-[64ch] text-[16px] leading-[1.65] text-muted-foreground">
                {faq.a}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Section>
  )
}
