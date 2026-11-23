import Link from 'next/link'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { NewRequestForm } from '@/components/tickets/ticket-forms'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { getAiConfig } from '@/lib/ai/config'
import { getConversation } from '@/lib/assistant/queries'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { listCategories } from '@/lib/tickets/queries'
import { categoryName } from '@/lib/tickets/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** New request. With ?c=<conversation>, it starts from the student's assistant conversation (handoff). */
export default async function NewRequestPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/requests/new'>) {
  const { tenant: slug } = await params
  const { c } = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, {
    permission: 'tickets.create',
    feature: 'ticketing',
  })
  const t = dict.tickets
  const { canWrite, notice } = writeMode(ctx, dict)
  const categories = ctx.tenantId ? await listCategories(ctx.tenantId, { activeOnly: true }) : []
  // Only the person's own conversation can be attached (RLS returns nothing otherwise).
  const conversation = ctx.tenantId && typeof c === 'string' ? await getConversation(ctx.tenantId, c) : null

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/requests`)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.requests.back}
      </Link>
      <PageHeader title={t.form.title} description={t.form.subtitle} />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      {canWrite || conversation ? (
        <Card className="max-w-3xl">
          <CardContent className="space-y-4 pt-6">
            {conversation ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MessageSquare aria-hidden className="size-4" />
                {t.form.fromChat}:{' '}
                <span className="font-medium text-foreground" dir="auto">
                  {conversation.title}
                </span>
              </p>
            ) : null}
            {canWrite ? (
              <NewRequestForm
                tenant={slug}
                locale={locale}
                categories={categories.map((cat) => ({
                  value: cat.id,
                  label: categoryName(locale, cat, cat.name),
                }))}
                conversationId={conversation?.id ?? null}
                aiAvailable={getAiConfig().configured}
                messages={formMessages(dict)}
                labels={{
                  category: t.form.category,
                  noCategory: t.form.noCategory,
                  subject: t.form.subject,
                  body: t.form.body,
                  bodyHint: t.form.bodyHint,
                  share: t.form.share,
                  shareHint: t.form.shareHint,
                  draft: t.form.draft,
                  drafting: t.form.drafting,
                  draftNote: t.form.draftNote,
                  submit: t.form.submit,
                  submitting: t.form.submitting,
                }}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  )
}
