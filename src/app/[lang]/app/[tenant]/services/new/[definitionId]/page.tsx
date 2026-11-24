import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { RequestForm } from '@/components/workflows/request-form'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { getPublishedForm } from '@/lib/workflows/queries'
import { formLabels, formTitle } from '@/lib/workflows/view'

/** One request form: fill in, review, confirm. */
export default async function NewServiceRequestPage({ params }: PageProps<'/[lang]/app/[tenant]/services/new/[definitionId]'>) {
  const { tenant: slug, definitionId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.create', feature: 'workflow_agent' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const found = await getPublishedForm(ctx.tenantId, definitionId)
  if (!found) notFound()
  const { definition: d, version: v } = found
  const w = dict.workflows
  const instructions = (locale === 'ar' && v.instructions_ar) || v.instructions

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/services`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {w.form.back}
      </Link>
      <PageHeader title={formTitle(locale, d)} description={(locale === 'ar' && d.description_ar) || d.description || undefined} />
      <div className="max-w-3xl space-y-4">
        {instructions ? (
          <Alert variant="info">
            <span className="font-medium">{w.form.instructions}: </span>
            <span className="whitespace-pre-line" dir="auto">
              {instructions}
            </span>
          </Alert>
        ) : null}
        {ctx.accessVia === 'support' ? <Alert variant="info">{w.unavailable.support}</Alert> : null}
        <Card>
          <CardContent className="pt-6">
            <RequestForm
              tenant={slug}
              locale={locale}
              form={{ id: d.id, versionId: v.id, title: formTitle(locale, d), fields: v.fields, confirmation: v.confirmation, confirmationAr: v.confirmation_ar }}
              labels={formLabels(dict)}
              messages={formMessages(dict)}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
