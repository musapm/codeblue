import { PageHero, Section } from '@/components/marketing/sections'
import { Alert } from '@/components/ui/alert'
import { getMarketingContent } from '@/content/marketing'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('about', '/about')

export default async function AboutPage() {
  const { locale, dict } = await getI18n()
  const c = getMarketingContent(locale).about

  return (
    <>
      <PageHero eyebrow={dict.nav.about} title={c.title} intro={c.intro} />
      <Section heading={c.principlesHeading}>
        <div className="grid gap-5 md:grid-cols-2">
          {c.principles.map((principle) => (
            <div key={principle.title} className="border-s-2 border-accent ps-5">
              <h3 className="font-semibold">{principle.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{principle.body}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section tone="muted">
        <Alert variant="info" title={c.statusHeading} className="max-w-3xl bg-card">
          {c.statusBody}
        </Alert>
      </Section>
    </>
  )
}
