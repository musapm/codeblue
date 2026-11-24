import Link from 'next/link'
import { MapPin, Search, Sparkles } from 'lucide-react'
import { AskCampus } from '@/components/campus/ask-campus'
import { CampusMap, MAP_HEIGHT, MAP_WIDTH, type MapPin as Pin } from '@/components/campus/campus-map'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/misc'
import { getAiConfig } from '@/lib/ai/config'
import { getCampusStatus, locationNames, searchLocations } from '@/lib/campus/queries'
import { KINDS, projectPoints, type Kind } from '@/lib/campus/schemas'
import { locationName, STATUS_VARIANT, statusNow, statusText } from '@/lib/campus/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** The campus directory: search, a simple map from coordinates, and AI answers when switched on. */
export default async function CampusPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/campus'>) {
  const { tenant: slug } = await params
  const sp = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { feature: 'campus_assistant' })
  const c = dict.campus
  const d = c.directory
  const base = localizedPath(locale, `/app/${slug}/campus`)
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : ''
  const kind = typeof sp.kind === 'string' && (KINDS as readonly string[]).includes(sp.kind) ? (sp.kind as Kind) : null

  const live = !ctx.user.isPreview && !!ctx.tenantId
  const [locations, status] = live ? await Promise.all([searchLocations(slug, q, kind), getCampusStatus(slug)]) : [[], null]
  const buildings = live ? await locationNames(ctx.tenantId!, locations.flatMap((l) => (l.parent_id ? [l.parent_id] : []))) : new Map()
  const tz = ctx.tenant.timezone
  const showAsk = live && ctx.accessVia !== 'support' && !!status?.aiEnabled && status.aiWithinBudget && getAiConfig().configured

  const mapped = locations.filter((l) => l.latitude !== null && l.longitude !== null)
  const projected = projectPoints(
    mapped.map((l) => ({ id: l.id, lat: l.latitude!, lon: l.longitude! })),
    MAP_WIDTH,
    MAP_HEIGHT,
    48,
  )
  const pins: Pin[] = projected.map((p) => {
    const l = mapped.find((x) => x.id === p.id)!
    return { ...p, label: locationName(locale, l), href: `${base}/${l.id}`, building: l.kind === 'building' }
  })

  return (
    <div className="space-y-6">
      {!live ? <Alert variant="info">{c.unavailable.preview}</Alert> : null}

      {showAsk ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles aria-hidden className="size-4 text-primary" />
              {c.ask.title}
            </CardTitle>
            <CardDescription>{c.ask.hint}</CardDescription>
          </CardHeader>
          <CardContent>
            <AskCampus
              tenant={slug}
              locale={locale}
              base={base}
              labels={{
                label: c.ask.label,
                placeholder: c.ask.placeholder,
                submit: c.ask.submit,
                submitting: c.ask.submitting,
                notFound: c.ask.notFound,
                basedOn: c.ask.basedOn,
                aiLabel: c.ask.aiLabel,
                notice: c.ask.notice,
              }}
              messages={formMessages(dict)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-4">
          <form method="get" role="search" className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 text-xs font-medium text-muted-foreground">
              {d.search}
              <Input name="q" defaultValue={q} maxLength={100} placeholder={d.searchPlaceholder} dir="auto" className="mt-1" />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              {d.kind}
              <Select name="kind" defaultValue={kind ?? ''} className="mt-1 min-w-40">
                <option value="">{d.allKinds}</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {c.kinds[k]}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="secondary">
              <Search aria-hidden />
              {d.searchSubmit}
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section aria-labelledby="campus-map-title" className="space-y-2">
              <h2 id="campus-map-title" className="text-sm font-semibold">
                {d.map}
              </h2>
              {pins.length ? <CampusMap pins={pins} title={d.map} hint={d.mapHint} /> : <p className="text-sm text-muted-foreground">{d.noMap}</p>}
            </section>
            <section aria-labelledby="campus-list-title" className="space-y-2">
              <h2 id="campus-list-title" className="text-sm font-semibold">
                {d.results(locations.length)}
              </h2>
              {locations.length === 0 ? (
                <EmptyState icon={<MapPin />} title={q || kind ? d.empty : d.emptyAll} />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {locations.map((l) => {
                    const s = statusNow(l, tz)
                    const building = l.parent_id ? buildings.get(l.parent_id) : undefined
                    return (
                      <li key={l.id} className="space-y-1 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`${base}/${l.id}`} className="font-medium text-primary hover:underline" dir="auto">
                            {locationName(locale, l)}
                          </Link>
                          {l.code ? (
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                              {l.code}
                            </span>
                          ) : null}
                          <Badge variant="outline">{c.kinds[l.kind]}</Badge>
                        </div>
                        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {building ? <span dir="auto">{d.in(locationName(locale, building))}</span> : null}
                          {l.floor ? <span>{d.floor(l.floor)}</span> : null}
                          <Badge variant={STATUS_VARIANT[s.state]}>{statusText(dict, s)}</Badge>
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
