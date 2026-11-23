import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, Send } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button'
import { pick } from '@/lib/admissions/public'
import { publicBranding } from '@/lib/admissions/public-view'
import { money } from '@/lib/admissions/view'
import { getPublicAdmissions } from '@/lib/admissions/visitor'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate } from '@/lib/management/view'

async function load(tenant: string, code: string) {
  const page = await getPublicAdmissions(tenant)
  const program = page?.programs.find((p) => p.code === decodeURIComponent(code))
  return page && program ? { page, program } : null
}

export async function generateMetadata({ params }: PageProps<'/[lang]/admissions/[tenant]/programs/[code]'>): Promise<Metadata> {
  const { tenant, code } = await params
  const { locale } = await getI18n()
  const found = await load(tenant, code)
  if (!found) return { robots: { index: false } }
  return { title: `${pick(locale, found.program.name, found.program.name_ar)} · ${publicBranding(found.page, locale).name}` }
}

export default async function PublicProgramPage({ params }: PageProps<'/[lang]/admissions/[tenant]/programs/[code]'>) {
  const { tenant, code } = await params
  const { locale, dict } = await getI18n()
  const found = await load(tenant, code)
  if (!found) notFound()
  const { page, program } = found
  const a = dict.admissions
  const p = a.public
  const base = localizedPath(locale, `/admissions/${page.tenant.slug}`)
  const text = (en: string | null, ar: string | null) => pick(locale, en, ar)

  const facts = [
    { label: p.labels.level, value: a.levels[program.level] ?? program.level },
    { label: p.labels.department, value: text(program.department, program.department_ar) },
    { label: p.labels.duration, value: program.duration_months ? a.months(program.duration_months) : null },
    { label: p.labels.mode, value: program.study_mode ? a.modes[program.study_mode] : null },
    { label: p.labels.language, value: program.teaching_language ? a.languages[program.teaching_language] : null },
    { label: p.labels.intakes, value: text(program.intakes, program.intakes_ar) },
    {
      label: p.labels.tuition,
      value:
        program.tuition_amount != null && program.tuition_currency
          ? `${money(locale, program.tuition_amount, program.tuition_currency)} ${a.periods[program.tuition_period ?? ''] ?? ''}`
          : null,
    },
    { label: p.labels.deadline, value: program.application_deadline ? formatDate(locale, program.application_deadline) : null },
  ].filter((f) => f.value)
  const note = text(program.tuition_note, program.tuition_note_ar)
  const requirements = text(program.requirements, program.requirements_ar)
  const description = text(program.description, program.description_ar)

  return (
    <article className="space-y-8">
      <Link href={base} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {p.backToPrograms}
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight" dir="auto">
          {text(program.name, program.name_ar)}
        </h1>
        <p className="font-mono text-sm text-muted-foreground" dir="ltr">
          {program.code}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {description ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">{p.labels.about}</h2>
              <p className="whitespace-pre-line text-muted-foreground" dir="auto">
                {description}
              </p>
            </section>
          ) : null}
          {requirements ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">{p.labels.requirements}</h2>
              <ul className="list-disc space-y-1 ps-5" dir="auto">
                {requirements
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="h-fit space-y-4 rounded-xl border border-border bg-card p-5">
          <dl className="space-y-3 text-sm">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
          {note ? (
            <p className="text-xs text-muted-foreground" dir="auto">
              {note}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {program.application_url ? (
              <a href={program.application_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ className: 'w-full' })}>
                <ExternalLink aria-hidden />
                {p.labels.apply}
              </a>
            ) : null}
            <Link href={`${base}?program=${program.id}#inquiry`} className={buttonClasses({ variant: 'secondary', className: 'w-full' })}>
              <Send aria-hidden className="rtl:-scale-x-100" />
              {p.inquiry.heading}
            </Link>
          </div>
          {program.updated_at ? <p className="text-xs text-muted-foreground">{p.labels.updated(formatDate(locale, program.updated_at))}</p> : null}
        </aside>
      </div>
    </article>
  )
}
