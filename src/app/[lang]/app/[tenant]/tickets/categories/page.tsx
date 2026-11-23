import Link from 'next/link'
import { ArrowLeft, Eye, EyeOff, Tags } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActionButton } from '@/components/management/action-form'
import { CategoryForm } from '@/components/tickets/ticket-forms'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { setCategoryActive } from '@/lib/tickets/actions'
import { listCategories } from '@/lib/tickets/queries'
import { categoryName, PRIORITY_VARIANT, ticketOptions } from '@/lib/tickets/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Ticket categories and routing: each category sends requests to a department's queue. */
export default async function TicketCategoriesPage({ params }: PageProps<'/[lang]/app/[tenant]/tickets/categories'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'departments.manage', feature: 'ticketing' })
  const t = dict.tickets
  const c = t.categories
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)
  const [categories, departments] = ctx.tenantId ? await Promise.all([listCategories(ctx.tenantId), listDepartments(ctx.tenantId)]) : [[], []]
  const departmentName = (id: string | null) => {
    const d = departments.find((x) => x.id === id)
    return d ? (locale === 'ar' && d.nameAr) || d.name : t.noDepartment
  }
  const { priorities } = ticketOptions(dict)
  const departmentOptions = departments.filter((d) => !d.archivedAt).map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name }))
  const hidden = { tenant: slug, locale }
  const labels = {
    name: c.name,
    nameAr: c.nameAr,
    department: c.department,
    noDepartment: t.noDepartment,
    priority: c.priority,
    sortOrder: c.sortOrder,
    optional: dict.common.optional,
    submit: c.create,
    saving: dict.management.saving,
  }
  const sorted = [...categories].sort((a, b) => Number(b.active) - Number(a.active))

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/tickets`)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.ticket.back}
      </Link>
      <PageHeader title={c.title} description={c.subtitle} />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardContent className="pt-6">
            {sorted.length === 0 ? (
              <EmptyState icon={<Tags />} title={c.empty} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {sorted.map((cat) => (
                  <li key={cat.id} className="space-y-3 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {categoryName(locale, cat, cat.name)}
                          <Badge variant={cat.active ? 'success' : 'neutral'}>{cat.active ? c.active : c.inactive}</Badge>
                          <Badge variant={PRIORITY_VARIANT[cat.default_priority] ?? 'neutral'}>{t.priorities[cat.default_priority] ?? cat.default_priority}</Badge>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">→ {departmentName(cat.department_id)}</p>
                      </div>
                      {canWrite ? (
                        <ActionButton
                          action={setCategoryActive}
                          hidden={{ categoryId: cat.id, active: cat.active ? 'false' : 'true' }}
                          messages={messages}
                          label={cat.active ? c.deactivate : c.activate}
                          icon={cat.active ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                        />
                      ) : null}
                    </div>
                    {canWrite ? (
                      <details className="rounded-lg border border-border bg-muted/30 open:bg-background">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{c.edit}</summary>
                        <div className="border-t border-border p-3">
                          <CategoryForm
                            hidden={hidden}
                            initial={{
                              id: cat.id,
                              name: cat.name,
                              nameAr: cat.name_ar,
                              departmentId: cat.department_id,
                              defaultPriority: cat.default_priority,
                              sortOrder: cat.sort_order,
                            }}
                            options={{ departments: departmentOptions, priorities }}
                            labels={{ ...labels, submit: c.save }}
                            messages={messages}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {canWrite ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{c.add}</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryForm hidden={hidden} options={{ departments: departmentOptions, priorities }} labels={labels} messages={messages} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
