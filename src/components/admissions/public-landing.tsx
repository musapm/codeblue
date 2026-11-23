import Link from 'next/link'
import { ArrowRight, CalendarClock, Clock, GraduationCap, Wallet } from 'lucide-react'
import { AdmissionsInteractive } from '@/components/admissions/public-admissions'
import type { ChatLabels } from '@/components/assistant/chat'
import { Badge } from '@/components/ui/badge'
import { consentFor, pick, type PublicAdmissions } from '@/lib/admissions/public'
import { publicBranding } from '@/lib/admissions/public-view'
import { money } from '@/lib/admissions/view'
import { localizedPath, type Locale } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import { formatDate } from '@/lib/management/view'

/** The public admissions landing page (presentational; data is loaded by the route). */
export function PublicAdmissionsView({
  page,
  locale,
  dict,
  hasSession,
  requestedProgram,
}: {
  page: PublicAdmissions
  locale: Locale
  dict: Dictionary
  hasSession: boolean
  requestedProgram: string | null
}) {
  const brand = publicBranding(page, locale)
  const a = dict.admissions
  const p = a.public
  const chat = dict.management.assistant.chat
  const base = localizedPath(locale, `/admissions/${page.tenant.slug}`)
  const selected = requestedProgram && page.programs.some((x) => x.id === requestedProgram) ? requestedProgram : null

  const chatLabels: ChatLabels = {
    placeholder: p.ask.placeholder,
    send: chat.send,
    searching: chat.searching,
    writing: chat.writing,
    you: chat.you,
    sources: chat.sources,
    pageSingle: chat.page(-1, null).replace('-1', '{from}'),
    pageRange: chat.page(-1, -2).replace('-1', '{from}').replace('-2', '{to}'),
    openSource: p.ask.programSource,
    sourceUnavailable: chat.sourceUnavailable,
    helpful: chat.helpful,
    notHelpful: chat.notHelpful,
    feedbackThanks: chat.feedbackThanks,
    feedbackComment: chat.feedbackComment,
    sendFeedback: chat.sendFeedback,
    statuses: chat.statuses,
    errors: p.ask.errors,
  }

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-primary uppercase">{p.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{p.heading(brand.name)}</h1>
        <p className="max-w-2xl text-muted-foreground" dir="auto">
          {pick(locale, page.settings.welcome, page.settings.welcome_ar) ?? p.defaultWelcome}
        </p>
      </section>

      <section aria-labelledby="programs-heading" className="space-y-4">
        <h2 id="programs-heading" className="text-xl font-semibold">
          {p.programsHeading}
        </h2>
        {page.programs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{p.noPrograms}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {page.programs.map((program) => {
              const facts = [
                program.duration_months ? { icon: <Clock aria-hidden className="size-3.5" />, text: a.months(program.duration_months) } : null,
                program.tuition_amount != null && program.tuition_currency
                  ? { icon: <Wallet aria-hidden className="size-3.5" />, text: `${money(locale, program.tuition_amount, program.tuition_currency)} ${a.periods[program.tuition_period ?? ''] ?? ''}` }
                  : null,
                program.application_deadline ? { icon: <CalendarClock aria-hidden className="size-3.5" />, text: formatDate(locale, program.application_deadline) } : null,
              ].filter((f) => f !== null)
              return (
                <li key={program.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start gap-3">
                    <GraduationCap aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <h3 className="font-semibold" dir="auto">
                        {pick(locale, program.name, program.name_ar)}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {[a.levels[program.level], pick(locale, program.department, program.department_ar)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  {facts.length ? (
                    <ul className="mt-4 space-y-1.5 text-sm">
                      {facts.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-muted-foreground">
                          {f.icon}
                          <span className="text-foreground">{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-auto pt-4">
                    <Link href={`${base}/programs/${encodeURIComponent(program.code)}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                      {p.viewProgram}
                      <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <AdmissionsInteractive
        tenant={page.tenant.slug}
        locale={locale}
        hasSession={hasSession}
        assistant={
          page.settings.assistant_enabled
            ? {
                name: brand.assistantName ?? dict.workspace.defaultAssistantName(brand.name),
                welcome: pick(locale, page.settings.welcome, page.settings.welcome_ar) ?? p.defaultWelcome,
                labels: chatLabels,
                programBase: `${base}/programs`,
                copy: {
                  heading: p.ask.heading,
                  description: p.ask.description,
                  start: p.ask.start,
                  starting: p.ask.starting,
                  disclaimer: p.ask.disclaimer,
                  leaveDetails: p.ask.leaveDetails,
                  leaveDetailsCta: p.ask.leaveDetailsCta,
                  errors: p.ask.errors,
                },
              }
            : null
        }
        inquiry={{
          copy: {
            heading: p.inquiry.heading,
            description: p.inquiry.description,
            fullName: a.fields.fullName,
            email: a.fields.email,
            phone: a.fields.phone,
            contactHint: p.inquiry.contactHint,
            country: a.fields.country,
            program: a.fields.program,
            anyProgram: p.inquiry.anyProgram,
            intake: a.fields.intake,
            intakeHint: a.fields.intakeHint,
            message: a.fields.message,
            optional: dict.common.optional,
            privacy: p.inquiry.privacy,
            submit: p.inquiry.submit,
            sending: p.inquiry.sending,
            success: p.inquiry.success('{reference}'),
            errors: p.inquiry.errors,
            validation: dict.validation,
          },
          programs: page.programs.map((x) => ({ value: x.id, label: pick(locale, x.name, x.name_ar) ?? x.name })),
          selectedProgram: selected,
          consent: consentFor(page, locale, p.defaultConsent(brand.name)),
          privacyUrl: page.settings.privacy_url,
        }}
      />
      {page.programs.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline">{p.eyebrow}</Badge> {p.accuracy}
        </p>
      ) : null}
    </div>
  )
}
