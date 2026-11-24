import Link from 'next/link'
import { MapPin, Plus } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { listLocations } from '@/lib/campus/queries'
import { locationName } from '@/lib/campus/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** All locations, published or not (campus.manage). */
export default async function ManageCampusPage({ params }: PageProps<'/[lang]/app/[tenant]/campus/manage'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'campus.manage', feature: 'campus_assistant' })
  const c = dict.campus
  const m = c.manage
  const { canWrite, notice } = writeMode(ctx, dict)
  const base = localizedPath(locale, `/app/${slug}/campus/manage`)
  const locations = ctx.tenantId && !ctx.user.isPreview ? await listLocations(ctx.tenantId) : []
  const byId = new Map(locations.map((l) => [l.id, l]))

  return (
    <div className="space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{m.title}</CardTitle>
            <CardDescription>{m.subtitle}</CardDescription>
          </div>
          {canWrite ? (
            <Link href={`${base}/new`} className={buttonClasses({ size: 'sm' })}>
              <Plus aria-hidden />
              {m.create}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <EmptyState icon={<MapPin />} title={m.empty} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {[m.columns.name, m.columns.kind, m.columns.building, m.columns.status].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {locations.map((l) => {
                    const parent = l.parent_id ? byId.get(l.parent_id) : undefined
                    return (
                      <tr key={l.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <Link href={`${base}/${l.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="auto">
                            {locationName(locale, l)}
                          </Link>
                          {l.code ? (
                            <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                              {l.code}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{c.kinds[l.kind]}</td>
                        <td className="px-3 py-2 text-muted-foreground" dir="auto">
                          {parent ? locationName(locale, parent) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={l.published ? 'success' : 'neutral'}>{l.published ? m.published : m.draft}</Badge>
                        </td>
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
  )
}
