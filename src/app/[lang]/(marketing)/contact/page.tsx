import { Check, Mail } from 'lucide-react'
import { ContactForm } from '@/components/forms/contact-form'
import { PageHero, Section } from '@/components/marketing/sections'
import { Card, CardContent } from '@/components/ui/card'
import { getMarketingContent } from '@/content/marketing'
import { platformBranding } from '@/lib/branding/platform'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('contact', '/contact')

export default async function ContactPage() {
  const { locale, dict } = await getI18n()
  const c = getMarketingContent(locale).contact

  return (
    <>
      <PageHero eyebrow={dict.nav.contact} title={c.title} intro={c.intro} />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardContent>
              <ContactForm
                copy={dict.contactForm}
                validation={dict.validation}
                rateLimitedMessage={dict.auth.errors.rateLimited}
                optionalLabel={dict.common.optional}
              />
            </CardContent>
          </Card>
          <aside className="space-y-6">
            <div>
              <h2 className="text-base font-semibold">{c.sideHeading}</h2>
              <ul className="mt-4 space-y-3">
                {c.sidePoints.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-card border border-border bg-canvas p-5">
              <p className="text-sm font-medium">{c.emailLabel}</p>
              <a href={`mailto:${platformBranding.salesEmail}`} className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" dir="ltr">
                <Mail aria-hidden className="size-4" />
                {platformBranding.salesEmail}
              </a>
            </div>
          </aside>
        </div>
      </Section>
    </>
  )
}
