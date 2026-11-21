import Link from 'next/link'
import { Check } from 'lucide-react'
import { PageHero, Section } from '@/components/marketing/sections'
import { buttonClasses } from '@/components/ui/button'
import { getMarketingContent } from '@/content/marketing'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'
import { cn } from '@/lib/utils'

export const generateMetadata = () => marketingMetadata('pricing', '/pricing')

/**
 * Prices are intentionally not hardcoded: plans are configurable per university (Phase 15).
 * Plan contents here describe the default packaging only.
 */
export default async function PricingPage() {
  const { locale, dict } = await getI18n()
  const c = getMarketingContent(locale).pricing

  return (
    <>
      <PageHero eyebrow={dict.nav.pricing} title={c.title} intro={c.intro} />
      <Section>
        <div className="grid gap-6 lg:grid-cols-3">
          {c.plans.map((plan) => (
            <article
              key={plan.name}
              className={cn(
                'flex flex-col rounded-card border bg-card p-6 md:p-8',
                plan.highlighted ? 'border-primary shadow-[0_0_0_1px_var(--color-primary)]' : 'border-border',
              )}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{plan.audience}</p>
              <p className="mt-6 text-2xl font-semibold tracking-tight">{c.priceLabel}</p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href={localizedPath(locale, '/contact')}
                className={buttonClasses({ variant: plan.highlighted ? 'primary' : 'secondary', className: 'mt-8 w-full' })}
              >
                {c.cta}
              </Link>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">{c.note}</p>
      </Section>
      <Section heading={c.faqHeading} tone="muted">
        <dl className="grid gap-5 md:grid-cols-3">
          {c.faq.map((item) => (
            <div key={item.q} className="rounded-card border border-border bg-card p-6">
              <dt className="font-semibold">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  )
}
