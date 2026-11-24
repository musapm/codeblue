import Link from 'next/link'
import { ArrowRight, ClipboardList, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { ServiceStarter } from '@/components/workflows/request-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { getAiConfig } from '@/lib/ai/config'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { definitionTitles, getWorkflowStatus, listMyRequests, listPublishedForms } from '@/lib/workflows/queries'
import { formLabels, formTitle, STATUS_VARIANT } from '@/lib/workflows/view'

/** Service requests for requesters: the forms they can use, an AI starter, and their own requests. */
export default async function ServicesPage({ params }: PageProps<'/[lang]/app/[tenant]/services'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.create', feature: 'workflow_agent' })
  const w = dict.workflows
  const s = w.services
  const base = localizedPath(locale, `/app/${slug}/services`)

  const live = !ctx.user.isPreview && !!ctx.tenantId
  const [forms, mine, status] = live
    ? await Promise.all([listPublishedForms(ctx.tenantId!), listMyRequests(ctx.tenantId!, ctx.user.id), getWorkflowStatus(slug)])
    : [[], [], null]
  const titles = live ? await definitionTitles(ctx.tenantId!, mine.map((r) => r.definition_id)) : new Map()
  const canWrite = live && ctx.accessVia !== 'support'
  const showSuggest = canWrite && forms.length > 0 && !!status?.aiEnabled && status.aiWithinBudget && getAiConfig().configured

  return (
    <>
      <PageHeader title={s.title} description={s.subtitle} />
      {!live ? (
        <Alert variant="info" className="mb-6">
          {w.unavailable.preview}
        </Alert>
      ) : ctx.accessVia === 'support' ? (
        <Alert variant="info" className="mb-6">
          {w.unavailable.support}
        </Alert>
      ) : null}

      <div className="space-y-6">
        {showSuggest ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles aria-hidden className="size-4 text-primary" />
                {s.suggest.title}
              </CardTitle>
              <CardDescription>{s.suggest.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ServiceStarter
                tenant={slug}
                locale={locale}
                forms={forms.map(({ definition: d, version: v }) => ({
                  id: d.id,
                  versionId: v.id,
                  title: formTitle(locale, d),
                  fields: v.fields,
                  confirmation: v.confirmation,
                  confirmationAr: v.confirmation_ar,
                }))}
                labels={{
                  label: s.suggest.label,
                  placeholder: s.suggest.placeholder,
                  submit: s.suggest.submit,
                  submitting: s.suggest.submitting,
                  suggested: s.suggest.suggested,
                  none: s.suggest.none,
                  missing: s.suggest.missing,
                  aiLabel: s.suggest.aiLabel,
                  notice: s.suggest.notice,
                }}
                formLabels={formLabels(dict)}
                messages={formMessages(dict)}
              />
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby="forms-heading" className="space-y-3">
          <h2 id="forms-heading" className="text-base font-semibold">
            {s.forms}
          </h2>
          {forms.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState icon={<ClipboardList />} title={s.formsEmpty} />
              </CardContent>
            </Card>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {forms.map(({ definition: d }) => (
                <li key={d.id}>
                  <Card className="flex h-full flex-col">
                    <CardHeader className="flex-1">
                      <CardTitle className="text-base" dir="auto">
                        {formTitle(locale, d)}
                      </CardTitle>
                      {d.description ? <CardDescription dir="auto">{(locale === 'ar' && d.description_ar) || d.description}</CardDescription> : null}
                    </CardHeader>
                    <CardContent>
                      <Link href={`${base}/new/${d.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })} aria-label={`${s.start}: ${formTitle(locale, d)}`}>
                        {s.start}
                        <ArrowRight aria-hidden className="rtl:-scale-x-100" />
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{s.mine}</CardTitle>
          </CardHeader>
          <CardContent>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">{s.mineEmpty}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-start text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 pe-4 text-start font-medium">{s.columns.reference}</th>
                      <th className="py-2 pe-4 text-start font-medium">{s.columns.form}</th>
                      <th className="py-2 pe-4 text-start font-medium">{s.columns.status}</th>
                      <th className="py-2 text-start font-medium">{s.columns.updated}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((r) => {
                      const title = titles.get(r.definition_id)
                      return (
                        <tr key={r.id} className="border-b border-border last:border-0">
                          <td className="py-2.5 pe-4">
                            <Link href={`${base}/${r.id}`} className="font-mono font-medium text-primary hover:underline" dir="ltr">
                              {r.reference}
                            </Link>
                          </td>
                          <td className="py-2.5 pe-4" dir="auto">
                            {title ? formTitle(locale, title) : ''}
                          </td>
                          <td className="py-2.5 pe-4">
                            <Badge variant={STATUS_VARIANT[r.status]}>{w.statuses[r.status]}</Badge>
                          </td>
                          <td className="py-2.5 text-muted-foreground">{formatDate(locale, r.last_activity_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
