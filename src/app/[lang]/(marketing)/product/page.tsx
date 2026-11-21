import Link from 'next/link'
import { Check } from 'lucide-react'
import { CtaBanner, PageHero, Section } from '@/components/marketing/sections'
import { buttonClasses } from '@/components/ui/button'
import { getMarketingContent } from '@/content/marketing'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('product', '/product')

export default async function ProductPage() {
  const { locale, dict } = await getI18n()
  const content = getMarketingContent(locale)
  const c = content.product

  return (
    <>
      <PageHero eyebrow={dict.nav.product} title={c.title} intro={c.intro} />
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {c.sections.map((section, i) => (
            <article key={section.title} className="rounded-card border border-border bg-card p-6 md:p-8">
              <p className="text-xs font-semibold text-accent">0{i + 1}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{section.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
              <ul className="mt-5 space-y-2.5">
                {section.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
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
