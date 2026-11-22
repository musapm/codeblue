import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  GraduationCap,
  Lock,
  MapPin,
  Quote,
  ScrollText,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { ChatPreview } from '@/components/marketing/chat-preview'
import { CtaBanner, FeatureCard, Section } from '@/components/marketing/sections'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { getMarketingContent } from '@/content/marketing'
import { PREVIEW_TENANT } from '@/lib/branding/demo-tenants'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('home', '/')

const AGENT_ICONS = {
  student: GraduationCap,
  admissions: UserPlus,
  academic: BookOpen,
  staff: BriefcaseBusiness,
  workflow: ClipboardList,
  campus: MapPin,
} as const

const PILLAR_ICONS = [Quote, Users, Building2]
const TRUST_ICONS = [Lock, UserCheck, Users, ScrollText]

export default async function HomePage() {
  const { locale, dict } = await getI18n()
  const c = getMarketingContent(locale).home
  const p = (path: string) => localizedPath(locale, path)

  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-canvas">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] bg-[size:48px_48px] opacity-50"
        />
        <div className="container-page relative grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden />
              {c.eyebrow}
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-foreground md:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
              {c.title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">{c.subtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={p('/contact')} className={buttonClasses({ size: 'lg' })}>
                {c.primaryCta}
              </Link>
              <Link href={p('/product')} className={buttonClasses({ size: 'lg', variant: 'secondary' })}>
                {c.secondaryCta}
                <ArrowRight aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </div>
          </div>
          <ChatPreview
            label={c.preview.label}
            universityName={c.preview.universityName}
            assistantName={c.preview.assistantName}
            monogram={PREVIEW_TENANT.monogram}
            question={c.preview.question}
            answer={c.preview.answer}
            citationTitle={c.preview.citationTitle}
            citationMeta={c.preview.citationMeta}
            escalation={c.preview.escalation}
            className="mx-auto w-full max-w-md lg:max-w-none"
          />
        </div>
      </section>

      <Section heading={c.pillarsHeading}>
        <div className="grid gap-5 md:grid-cols-3">
          {c.pillars.map((pillar, i) => {
            const Icon = PILLAR_ICONS[i] ?? Quote
            return <FeatureCard key={pillar.title} icon={<Icon />} title={pillar.title} body={pillar.body} />
          })}
        </div>
      </Section>

      <Section heading={c.agentsHeading} subheading={c.agentsSubheading} tone="muted">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {c.agents.map((agent) => {
            const Icon = AGENT_ICONS[agent.key]
            return (
              <FeatureCard
                key={agent.key}
                icon={<Icon />}
                title={agent.title}
                body={agent.body}
                badge={<Badge variant="warning">{dict.common.inDevelopment}</Badge>}
              />
            )
          })}
        </div>
      </Section>

      <Section heading={c.howHeading}>
        <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {c.howSteps.map((step, i) => (
            <li key={step.title} className="relative rounded-card border border-border bg-card p-6">
              <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                {i + 1}
              </span>
              <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section heading={c.trustHeading} subheading={c.trustBody} tone="muted">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {c.trustItems.map((item, i) => {
            const Icon = TRUST_ICONS[i] ?? Lock
            return <FeatureCard key={item.title} icon={<Icon />} title={item.title} body={item.body} />
          })}
        </div>
      </Section>

      <CtaBanner
        title={c.ctaTitle}
        body={c.ctaBody}
        actions={
          <>
            <Link href={p('/contact')} className={buttonClasses({ size: 'lg', variant: 'inverse' })}>
              {dict.common.requestDemo}
            </Link>
            <Link href={p('/demo')} className={buttonClasses({ size: 'lg', variant: 'ghost', className: 'text-white hover:bg-white/10' })}>
              {dict.nav.demo}
            </Link>
          </>
        }
      />
    </>
  )
}
