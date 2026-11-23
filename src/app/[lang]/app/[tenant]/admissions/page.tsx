import Link from 'next/link'
import { Inbox, Search } from 'lucide-react'
import { ManualLeadForm } from '@/components/admissions/staff-forms'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/misc'
import { listAssignees, listLeads, listPrograms } from '@/lib/admissions/queries'
import { LEAD_STAGES } from '@/lib/admissions/schemas'
import { admissionsOptions, personName, programName, STAGE_VARIANT } from '@/lib/admissions/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission } from '@/lib/tenancy/context'

export default async function AdmissionsLeadsPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/admissions'>) {
  const { tenant: slug } = await params
  const sp = await searchParams
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const filters = {
    stage: LEAD_STAGES.includes(one('stage') as never) ? one('stage') : undefined,
    program: one('program'),
    assigned: one('assigned') === 'me' || one('assigned') === 'none' ? one('assigned') : undefined,
    q: one('q')?.slice(0, 80),
  }
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const a = dict.admissions
  const { canWrite, notice } = writeMode(ctx, dict)
  const canManage = canWrite && hasWorkspacePermission(ctx, 'leads.manage')
  const base = localizedPath(locale, `/app/${slug}/admissions`)

  const [result, programs, assignees] = ctx.tenantId
    ? await Promise.all([listLeads(ctx.tenantId, ctx.user.id, filters), listPrograms(ctx.tenantId), listAssignees(slug)])
    : [{ leads: [], total: 0 }, [], []]
  const programById = new Map(programs.map((p) => [p.id, p]))
  const personById = new Map(assignees.map((p) => [p.user_id, p]))
  const filtered = Boolean(filters.stage || filters.program || filters.assigned || filters.q)
  const options = admissionsOptions(dict)
  const programOptions = programs.filter((p) => p.status !== 'archived').map((p) => ({ value: p.id, label: programName(locale, p) }))

  return (
    <div className="space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>{a.leads.heading}</CardTitle>
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <label className="min-w-40 flex-1 space-y-1 text-xs font-medium text-muted-foreground">
              {a.leads.filters.search}
              <Input name="q" defaultValue={filters.q} maxLength={80} dir="auto" />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {a.leads.filters.stage}
              <Select name="stage" defaultValue={filters.stage ?? ''}>
                <option value="">{a.leads.filters.allStages}</option>
                {options.stages.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {a.leads.filters.program}
              <Select name="program" defaultValue={filters.program ?? ''}>
                <option value="">{a.leads.filters.allPrograms}</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {programName(locale, p)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {a.leads.filters.assigned}
              <Select name="assigned" defaultValue={filters.assigned ?? ''}>
                <option value="">{a.leads.filters.anyone}</option>
                <option value="me">{a.leads.filters.me}</option>
                <option value="none">{a.leads.filters.unassigned}</option>
              </Select>
            </label>
            <Button type="submit" variant="secondary">
              <Search aria-hidden />
              {a.leads.filters.apply}
            </Button>
            {filtered ? (
              <Link href={base} className={buttonClasses({ variant: 'ghost' })}>
                {a.leads.filters.clear}
              </Link>
            ) : null}
          </form>
        </CardHeader>
        <CardContent>
          {result.leads.length === 0 ? (
            <EmptyState icon={<Inbox />} title={filtered ? a.leads.emptyFiltered : a.leads.empty} />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{a.leads.shown(result.leads.length, result.total)}</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
                    <tr>
                      {[a.leads.columns.reference, a.leads.columns.name, a.leads.columns.program, a.leads.columns.stage, a.leads.columns.source, a.leads.columns.assigned, a.leads.columns.received].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.leads.map((l) => {
                      const program = l.program_id ? programById.get(l.program_id) : undefined
                      return (
                        <tr key={l.id} className="hover:bg-muted/40">
                          <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                            <Link href={`${base}/leads/${l.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                              {l.reference}
                            </Link>
                          </td>
                          <td className="px-3 py-2" dir="auto">
                            {l.full_name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{program ? programName(locale, program) : '—'}</td>
                          <td className="px-3 py-2">
                            <Badge variant={STAGE_VARIANT[l.stage] ?? 'neutral'}>{a.stages[l.stage] ?? l.stage}</Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{a.sources[l.source] ?? l.source}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.assigned_to ? personName(personById.get(l.assigned_to), a.lead.someone) : '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDate(locale, l.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{a.leads.add}</CardTitle>
            <CardDescription>{a.leads.addDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <ManualLeadForm
              hidden={{ tenant: slug, locale }}
              options={{ programs: programOptions, locales: options.locales }}
              messages={formMessages(dict)}
              labels={{
                ...a.fields,
                consentNote: a.leads.consentNote,
                consentNoteHint: a.leads.consentNoteHint,
                optional: dict.common.optional,
                submit: a.leads.create,
                saving: dict.management.saving,
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
