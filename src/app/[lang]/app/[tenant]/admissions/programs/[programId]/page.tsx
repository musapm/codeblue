import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, ArrowLeft, Eye, EyeOff, Trash2 } from 'lucide-react'
import { ProgramForm } from '@/components/admissions/staff-forms'
import { ActionButton } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteProgram, setProgramStatus } from '@/lib/admissions/actions'
import { programFormLabels } from '@/lib/admissions/program-labels'
import { getProgram } from '@/lib/admissions/queries'
import { admissionsOptions, programName, PROGRAM_STATUS_VARIANT } from '@/lib/admissions/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function ProgramPage({ params }: PageProps<'/[lang]/app/[tenant]/admissions/programs/[programId]'>) {
  const { tenant: slug, programId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'programs.manage', feature: 'admissions_agent' })
  if (!ctx.tenantId) notFound()
  const [program, departments] = await Promise.all([getProgram(ctx.tenantId, programId), listDepartments(ctx.tenantId)])
  if (!program) notFound()
  const a = dict.admissions
  const { canWrite, notice } = writeMode(ctx, dict)
  const messages = formMessages(dict)
  const status = (next: string, label: string, icon: React.ReactNode) => (
    <ActionButton action={setProgramStatus} hidden={{ programId: program.id, status: next }} messages={messages} label={label} icon={icon} />
  )

  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, `/app/${slug}/admissions/programs`)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {a.programs.back}
      </Link>
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle>{programName(locale, program)}</CardTitle>
          <Badge variant={PROGRAM_STATUS_VARIANT[program.status] ?? 'neutral'}>{a.programStatus[program.status] ?? program.status}</Badge>
          {canWrite ? (
            <div className="ms-auto flex flex-wrap gap-2">
              {program.status !== 'published' ? status('published', a.programs.publish, <Eye aria-hidden />) : status('draft', a.programs.unpublish, <EyeOff aria-hidden />)}
              {program.status !== 'archived' ? status('archived', a.programs.archive, <Archive aria-hidden />) : null}
              <ActionButton
                action={deleteProgram}
                hidden={{ programId: program.id, tenant: slug, locale }}
                messages={messages}
                confirmMessage={a.programs.deleteConfirm}
                label={a.programs.delete}
                variant="danger"
                icon={<Trash2 aria-hidden />}
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <CardDescription className="mb-4">
            {a.programs.publishedHint} {program.published_at ? `· ${formatDate(locale, program.published_at)}` : ''}
          </CardDescription>
          {canWrite ? (
            <ProgramForm
              hidden={{ tenant: slug, locale }}
              initial={program}
              options={{
                ...admissionsOptions(dict),
                departments: departments.filter((d) => !d.archivedAt || d.id === program.department_id).map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name })),
              }}
              labels={programFormLabels(dict, a.programs.save)}
              messages={messages}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
