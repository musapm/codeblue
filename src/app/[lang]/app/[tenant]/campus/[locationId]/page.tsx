import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, ExternalLink, Minus, Pencil, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getLocation, listChildren, locationNames } from '@/lib/campus/queries'
import { ACCESS_KEYS, formatDayRanges, osmLink } from '@/lib/campus/schemas'
import { dayOrder, locationName, STATUS_VARIANT, statusNow, statusText, todayIn } from '@/lib/campus/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'

/** One campus location: where it is, hours (open now), accessibility, contact, what is inside. */
export default async function CampusLocationPage({ params }: PageProps<'/[lang]/app/[tenant]/campus/[locationId]'>) {
  const { tenant: slug, locationId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { feature: 'campus_assistant' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const l = await getLocation(ctx.tenantId, locationId)
  if (!l) notFound()
  const c = dict.campus
  const t = c.location
  const base = localizedPath(locale, `/app/${slug}/campus`)
  const tz = ctx.tenant.timezone
  const [children, parents, departments] = await Promise.all([
    l.kind === 'building' ? listChildren(ctx.tenantId, l.id) : Promise.resolve([]),
    locationNames(ctx.tenantId, l.parent_id ? [l.parent_id] : []),
    l.department_id ? listDepartments(ctx.tenantId) : Promise.resolve([]),
  ])
  const parent = l.parent_id ? parents.get(l.parent_id) : undefined
  const department = departments.find((d) => d.id === l.department_id)
  const status = statusNow(l, tz)
  const today = todayIn(tz)
  const description = (locale === 'ar' && l.description_ar) || l.description
  const hoursNote = (locale === 'ar' && l.hours_note_ar) || l.hours_note
  const accessNote = (locale === 'ar' && l.accessibility_note_ar) || l.accessibility_note

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={base} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t.back}
        </Link>
        {hasWorkspacePermission(ctx, 'campus.manage') ? (
          <Link href={`${base}/manage/${l.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <Pencil aria-hidden />
            {c.tabs.manage}
          </Link>
        ) : null}
      </div>
      <div className="mb-6 space-y-2">
        <h2 className="text-xl font-semibold" dir="auto">
          {locationName(locale, l)}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{c.kinds[l.kind]}</Badge>
          {l.code ? (
            <span className="font-mono" dir="ltr">
              {l.code}
            </span>
          ) : null}
          <Badge variant={STATUS_VARIANT[status.state]}>{statusText(dict, status)}</Badge>
        </p>
        {!l.published ? <Alert variant="warning">{t.draft}</Alert> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.about}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {description ? (
                <p className="whitespace-pre-line" dir="auto">
                  {description}
                </p>
              ) : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                {parent ? (
                  <>
                    <dt className="text-muted-foreground">{t.building}</dt>
                    <dd>
                      <Link href={`${base}/${l.parent_id}`} className="text-primary hover:underline" dir="auto">
                        {locationName(locale, parent)}
                      </Link>
                    </dd>
                  </>
                ) : null}
                {l.floor ? (
                  <>
                    <dt className="text-muted-foreground">{t.floor}</dt>
                    <dd dir="auto">{l.floor}</dd>
                  </>
                ) : null}
                {department ? (
                  <>
                    <dt className="text-muted-foreground">{t.department}</dt>
                    <dd>{(locale === 'ar' && department.nameAr) || department.name}</dd>
                  </>
                ) : null}
                {l.aliases.length ? (
                  <>
                    <dt className="text-muted-foreground">{t.otherNames}</dt>
                    <dd dir="auto">{l.aliases.join(locale === 'ar' ? '، ' : ', ')}</dd>
                  </>
                ) : null}
              </dl>
              {l.latitude !== null && l.longitude !== null ? (
                <p className="space-y-1">
                  <a href={osmLink(l.latitude, l.longitude)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    <ExternalLink aria-hidden className="size-4 rtl:-scale-x-100" />
                    {t.openMap}
                  </a>
                  <span className="block text-xs text-muted-foreground">{t.openMapNote}</span>
                </p>
              ) : null}
            </CardContent>
          </Card>

          {l.phone || l.email || l.url ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.contact}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {l.phone ? (
                    <>
                      <dt className="text-muted-foreground">{t.phone}</dt>
                      <dd>
                        <a href={`tel:${l.phone.replace(/[^+0-9]/g, '')}`} className="text-primary hover:underline" dir="ltr">
                          {l.phone}
                        </a>
                      </dd>
                    </>
                  ) : null}
                  {l.email ? (
                    <>
                      <dt className="text-muted-foreground">{t.email}</dt>
                      <dd>
                        <a href={`mailto:${l.email}`} className="text-primary hover:underline" dir="ltr">
                          {l.email}
                        </a>
                      </dd>
                    </>
                  ) : null}
                  {l.url ? (
                    <>
                      <dt className="text-muted-foreground">{t.website}</dt>
                      <dd className="truncate">
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" dir="ltr">
                          {l.url.replace(/^https:\/\//, '')}
                        </a>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {children.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.inside}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {children.map((child) => (
                    <li key={child.id} className="flex flex-wrap items-center gap-2 py-2">
                      <Link href={`${base}/${child.id}`} className="font-medium text-primary hover:underline" dir="auto">
                        {locationName(locale, child)}
                      </Link>
                      <Badge variant="outline">{c.kinds[child.kind]}</Badge>
                      {child.floor ? <span className="text-xs text-muted-foreground">{c.directory.floor(child.floor)}</span> : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.hours}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {l.hours ? (
                <table className="w-full">
                  <caption className="sr-only">{t.hours}</caption>
                  <tbody>
                    {dayOrder(locale).map((d) => (
                      <tr key={d} className={cn('border-b border-border last:border-0', d === today && 'font-semibold')}>
                        <th scope="row" className="py-1.5 text-start font-medium">
                          {c.days[d]}
                          {d === today ? <span className="ms-2 text-xs font-normal text-muted-foreground">({t.today})</span> : null}
                        </th>
                        <td className="py-1.5 text-end" dir="ltr">
                          {formatDayRanges(l.hours![d]) || <span className="text-muted-foreground">{t.closedAllDay}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted-foreground">{t.noHours}</p>
              )}
              {hoursNote ? (
                <p className="text-muted-foreground" dir="auto">
                  {hoursNote}
                </p>
              ) : null}
              {l.hours ? <p className="text-xs text-muted-foreground">{t.timezone(tz)}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.access}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="space-y-1.5">
                {ACCESS_KEYS.map((k) => {
                  const v = l.access[k]
                  const Icon = v === true ? Check : v === false ? X : Minus
                  return (
                    <li key={k} className="flex items-center gap-2">
                      <Icon aria-hidden className={cn('size-4 shrink-0', v === true ? 'text-success' : v === false ? 'text-danger' : 'text-muted-foreground')} />
                      <span>{c.access[k]}</span>
                      <span className="ms-auto text-muted-foreground">{v === true ? c.accessValues.yes : v === false ? c.accessValues.no : c.accessValues.unknown}</span>
                    </li>
                  )
                })}
              </ul>
              {accessNote ? (
                <p className="text-muted-foreground" dir="auto">
                  {accessNote}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
