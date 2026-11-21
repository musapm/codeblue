import { PageHero, Section } from '@/components/marketing/sections'
import { getMarketingContent } from '@/content/marketing'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('features', '/features')

export default async function FeaturesPage() {
  const { locale, dict } = await getI18n()
  const c = getMarketingContent(locale).features

  return (
    <>
      <PageHero eyebrow={dict.nav.features} title={c.title} intro={c.intro} />
      {c.groups.map((group, i) => (
        <Section key={group.title} tone={i % 2 === 1 ? 'muted' : 'default'}>
          <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
            <h2 className="text-xl font-semibold tracking-tight">{group.title}</h2>
            <dl className="grid gap-5 sm:grid-cols-3">
              {group.items.map((item) => (
                <div key={item.title} className="rounded-card border border-border bg-card p-5">
                  <dt className="text-sm font-semibold">{item.title}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>
      ))}
    </>
  )
}
