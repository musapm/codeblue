import { BriefcaseBusiness, GraduationCap, Landmark, UserPlus } from 'lucide-react'
import { PageHero, Section } from '@/components/marketing/sections'
import { getMarketingContent } from '@/content/marketing'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('solutions', '/solutions')

const ICONS = [GraduationCap, UserPlus, BriefcaseBusiness, Landmark]

export default async function SolutionsPage() {
  const { locale, dict } = await getI18n()
  const c = getMarketingContent(locale).solutions

  return (
    <>
      <PageHero eyebrow={dict.nav.solutions} title={c.title} intro={c.intro} />
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {c.audiences.map((audience, i) => {
            const Icon = ICONS[i] ?? GraduationCap
            return (
              <article key={audience.title} className="flex flex-col rounded-card border border-border bg-card p-6 md:p-8">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <h2 className="text-lg font-semibold">{audience.title}</h2>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{audience.body}</p>
                <ul className="mt-5 space-y-2 border-t border-border pt-5">
                  {audience.outcomes.map((outcome) => (
                    <li key={outcome} className="flex items-start gap-2.5 text-sm">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                      {outcome}
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      </Section>
    </>
  )
}
