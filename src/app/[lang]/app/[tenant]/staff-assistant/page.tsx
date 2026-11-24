import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquare, Plus } from 'lucide-react'
import type { ChatLabels } from '@/components/assistant/chat'
import { StaffChat } from '@/components/staff/staff-chat'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getConversation, listConversations } from '@/lib/assistant/queries'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate } from '@/lib/management/view'
import { getStaffStatus } from '@/lib/staff/queries'
import { departmentOptions, staffUnavailable } from '@/lib/staff/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'
import { getVoiceStatus } from '@/lib/voice/queries'
import { voiceConfig } from '@/lib/voice/view'

/** Staff questions over the documents the staff member may read, optionally one department's. */
export default async function StaffAskPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/staff-assistant'>) {
  const { tenant: slug } = await params
  const { c } = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const base = localizedPath(locale, `/app/${slug}/staff-assistant`)
  // Administrators without the staff permission only have the settings tab.
  if (!hasWorkspacePermission(ctx, 'assistant.staff.use') && hasWorkspacePermission(ctx, 'assistant.configure')) redirect(`${base}/settings`)
  requireWorkspaceAccess(ctx, { permission: 'assistant.staff.use', feature: 'staff_assistant' })
  const s = dict.staff
  const a = dict.management.assistant.chat
  const requested = typeof c === 'string' ? c : null

  const live = !ctx.user.isPreview && !!ctx.tenantId && ctx.accessVia !== 'support'
  const [status, conversations, conversation, departments, voiceStatus] = live
    ? await Promise.all([
        getStaffStatus(slug),
        listConversations(ctx.tenantId!, 30, 'staff'),
        requested ? getConversation(ctx.tenantId!, requested, 'staff') : Promise.resolve(null),
        listDepartments(ctx.tenantId!),
        getVoiceStatus(slug, 'staff_chat'),
      ])
    : [null, [], null, [], null]
  const unavailable = staffUnavailable(ctx, status, dict)
  const voice = unavailable ? undefined : voiceConfig(dict, locale, slug, 'staff_chat', voiceStatus)

  const labels: ChatLabels = {
    placeholder: s.chat.placeholder,
    send: a.send,
    searching: s.chat.searching,
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
    statuses: s.chat.statuses,
    errors: { ...a.unavailable, ...s.unavailable },
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0 space-y-3">
        <StaffChat
          key={conversation?.id ?? 'new'}
          tenant={slug}
          locale={locale}
          basePath={base}
          assistantName={s.chat.assistantName}
          welcome={s.chat.welcome}
          conversationId={conversation?.id ?? null}
          initialMessages={conversation?.messages ?? []}
          unavailable={unavailable}
          labels={labels}
          departments={departmentOptions(locale, departments)}
          departmentLabels={{ label: s.chat.department, all: s.chat.allDepartments }}
          voice={voice}
        />
        <p className="text-xs text-muted-foreground">{s.chat.disclaimer}</p>
        {voice ? <p className="text-xs text-muted-foreground">{dict.voice.notice[voice.provider]}</p> : null}
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
  )
}
