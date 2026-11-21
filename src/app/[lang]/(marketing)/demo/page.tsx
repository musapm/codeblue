import Link from 'next/link'
import { CtaBanner, PageHero, Section } from '@/components/marketing/sections'
import { WhiteLabelDemo } from '@/components/marketing/white-label-demo'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { getMarketingContent } from '@/content/marketing'
import { DEMO_TENANTS } from '@/lib/branding/demo-tenants'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('demo', '/demo')

export default async function DemoPage() {
  const { locale, dict } = await getI18n()
  const content = getMarketingContent(locale)
  const c = content.demo
  const preview = content.home.preview

  return (
    <>
      <PageHero eyebrow={dict.nav.demo} title={c.title} intro={c.intro}>
        <Badge variant="warning" className="mt-6">
          {dict.common.fictional}
        </Badge>
      </PageHero>

      <Section heading={c.whiteLabelHeading} subheading={c.whiteLabelBody}>
        <WhiteLabelDemo
          locale={locale}
          tenants={DEMO_TENANTS}
          labels={{
            switchLabel: c.whiteLabelSwitch,
            note: c.whiteLabelNote,
            question: preview.question,
            answer: preview.answer,
            citationTitle: preview.citationTitle,
            citationMeta: preview.citationMeta,
            escalation: preview.escalation,
            fictional: dict.common.fictional,
          }}
        />
      </Section>

      <Section heading={c.stepsHeading} tone="muted">
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {c.steps.map((step, i) => (
            <li key={step.title} className="rounded-card border border-border bg-card p-6">
              <span className="text-xs font-semibold text-accent">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-2 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CtaBanner
        title={content.home.ctaTitle}
        body={content.home.ctaBody}
        actions={
          <Link href={localizedPath(locale, '/contact')} className={buttonClasses({ size: 'lg', variant: 'inverse' })}>
            {dict.common.requestDemo}
          </Link>
        }
      />
    </>
  )
}
