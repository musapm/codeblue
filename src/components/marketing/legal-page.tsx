import { LegalDraftNotice, PageHero, Section } from '@/components/marketing/sections'
import type { MarketingContent } from '@/content/marketing'

export function LegalPage({ title, sections, legal }: { title: string; sections: { title: string; body: string }[]; legal: MarketingContent['legal'] }) {
  return (
    <>
      <PageHero title={title} intro={`${legal.updatedLabel}: ${legal.updated}`} />
      <Section>
        <div className="max-w-3xl space-y-8">
          <LegalDraftNotice>{legal.draftNotice}</LegalDraftNotice>
          {sections.map((section, i) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold">
                {i + 1}. {section.title}
              </h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </Section>
    </>
  )
}
