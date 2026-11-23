import Link from 'next/link'
import { MessageSquare, Plus } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { AssistantChat, HandoffNote, type ChatLabels } from '@/components/assistant/chat'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAiConfig } from '@/lib/ai/config'
import { getAssistantStatus, getConversation, listConversations } from '@/lib/assistant/queries'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate } from '@/lib/management/view'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canSeeNavItem } from '@/lib/navigation/workspace-nav'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'

/** Student assistant: ask questions, answered from the university's published documents with sources. */
export default async function AskPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/ask'>) {
  const { tenant: slug } = await params
  const { c } = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.use', feature: 'student_assistant' })
  const a = dict.management.assistant.chat
  const base = localizedPath(locale, `/app/${slug}/ask`)
  const requested = typeof c === 'string' ? c : null

  let unavailable: string | null = null
  let conversations: Awaited<ReturnType<typeof listConversations>> = []
  let conversation: Awaited<ReturnType<typeof getConversation>> = null
  let supportEmail: string | null = null

  if (ctx.user.isPreview || !ctx.tenantId) {
    unavailable = a.unavailable.preview!
  } else if (ctx.accessVia === 'support') {
    unavailable = a.unavailable.forbidden!
  } else {
    const supabase = await createSupabaseServerClient()
    const [status, list, current, settings] = await Promise.all([
      getAssistantStatus(slug),
      listConversations(ctx.tenantId),
      requested ? getConversation(ctx.tenantId, requested) : Promise.resolve(null),
      supabase.from('tenant_settings').select('support_email').eq('tenant_id', ctx.tenantId).maybeSingle(),
    ])
    conversations = list
    conversation = current
    supportEmail = settings.data?.support_email ?? null
    if (!getAiConfig().configured) unavailable = a.unavailable.notConfigured!
    else if (!status.enabled) unavailable = a.unavailable.disabled!
    else if (!status.withinBudget) unavailable = a.unavailable.budget!
  }

  const labels: ChatLabels = {
    placeholder: a.placeholder,
    send: a.send,
    searching: a.searching,
    writing: a.writing,
    you: a.you,
    sources: a.sources,
    pageSingle: a.page(-1, null).replace('-1', '{from}'),
    pageRange: a.page(-1, -2).replace('-1', '{from}').replace('-2', '{to}'),
    openSource: a.openSource,
    sourceUnavailable: a.sourceUnavailable,
    helpful: a.helpful,
    notHelpful: a.notHelpful,
    feedbackThanks: a.feedbackThanks,
    feedbackComment: a.feedbackComment,
    sendFeedback: a.sendFeedback,
    statuses: a.statuses,
    errors: a.unavailable,
  }

  // Human handoff (Phase 7): a request to staff, prefilled from this conversation.
  // The link appears in the chat after an answer; it works even when the assistant is paused.
  const canAskPerson =
    !ctx.user.isPreview &&
    ctx.accessVia !== 'support' &&
    canSeeNavItem({ key: '', segment: '', icon: 'tickets', status: 'available', phase: 7, permission: 'tickets.create', feature: 'ticketing' }, ctx.access)
  const handoff = canAskPerson
    ? { href: localizedPath(locale, `/app/${slug}/requests/new`), label: dict.tickets.handoff.askPerson, hint: dict.tickets.handoff.askPersonHint }
    : undefined

  return (
    <>
      <PageHeader title={a.title(ctx.tenant.assistantName)} description={a.subtitle} />
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-3">
          <AssistantChat
            key={conversation?.id ?? 'new'}
            tenant={slug}
            locale={locale}
            basePath={base}
            assistantName={ctx.tenant.assistantName}
            welcome={ctx.tenant.welcome}
            conversationId={conversation?.id ?? null}
            initialMessages={conversation?.messages ?? []}
            unavailable={unavailable}
            labels={labels}
            handoff={handoff}
          />
          <p className="text-xs text-muted-foreground">{a.disclaimer}</p>
          {supportEmail ? <HandoffNote text={a.handoff(supportEmail)} /> : null}
        </div>

        <Card className="h-fit">
          <CardHeader className="gap-3">
            <CardTitle className="text-sm">{a.history}</CardTitle>
            <Link href={base} className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'w-full' })}>
              <Plus aria-hidden />
              {a.newChat}
            </Link>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{a.noConversations}</p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`${base}?c=${item.id}`}
                      aria-current={item.id === conversation?.id ? 'page' : undefined}
                      className={cn('flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted', item.id === conversation?.id && 'bg-muted font-medium')}
                    >
                      <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate" dir="auto">
                          {item.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">{formatDate(locale, item.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
