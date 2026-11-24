import Link from 'next/link'
import { FileText } from 'lucide-react'
import { DraftForm } from '@/components/staff/drafts'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate, formMessages } from '@/lib/management/view'
import { DRAFT_KINDS, TONES } from '@/lib/staff/schemas'
import { getStaffStatus, listDrafts } from '@/lib/staff/queries'
import { departmentOptions, staffUnavailable } from '@/lib/staff/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Write a draft with AI; the caller's own drafts. */
export default async function StaffDraftsPage({ params }: PageProps<'/[lang]/app/[tenant]/staff-assistant/drafts'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.staff.use', feature: 'staff_assistant' })
  const s = dict.staff
  const d = s.drafts
  const base = localizedPath(locale, `/app/${slug}/staff-assistant/drafts`)

  const live = !ctx.user.isPreview && !!ctx.tenantId && ctx.accessVia !== 'support'
  const [status, drafts, departments] = live
    ? await Promise.all([getStaffStatus(slug), listDrafts(ctx.tenantId!), listDepartments(ctx.tenantId!)])
    : [null, [], []]
  const unavailable = staffUnavailable(ctx, status, dict)

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>{d.title}</CardTitle>
          <CardDescription>{d.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unavailable ? (
            <Alert variant="info">{unavailable}</Alert>
          ) : (
            <DraftForm
              tenant={slug}
              locale={locale}
              kinds={DRAFT_KINDS.map((k) => ({ value: k, label: d.kinds[k] ?? k }))}
              tones={TONES.map((t) => ({ value: t, label: d.tones[t] ?? t }))}
              languages={(['en', 'ar'] as const).map((l) => ({ value: l, label: d.languages[l] ?? l }))}
              departments={departmentOptions(locale, departments)}
              labels={{
                kind: d.kind,
                audience: d.audience,
                audiencePlaceholder: d.audiencePlaceholder,
                purpose: d.purpose,
                purposePlaceholder: d.purposePlaceholder,
                tone: d.tone,
                language: d.language,
                useDocuments: d.useDocuments,
                department: d.department,
                allDepartments: d.allDepartments,
                submit: d.submit,
                submitting: d.submitting,
              }}
              messages={formMessages(dict)}
            />
          )}
          <p className="text-xs text-muted-foreground">{d.privateNote}</p>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">{d.mine}</CardTitle>
        </CardHeader>
        <CardContent>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {drafts.map((item) => (
                <li key={item.id}>
                  <Link href={`${base}/${item.id}`} className="flex items-start gap-2 rounded-md px-1 py-2.5 text-sm hover:bg-muted">
                    <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" dir="auto">
                        {item.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{d.kinds[item.kind] ?? item.kind}</Badge>
                        {formatDate(locale, item.createdAt)}
                      </span>
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
