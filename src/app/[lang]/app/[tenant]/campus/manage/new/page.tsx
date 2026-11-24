import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { LocationForm } from '@/components/campus/location-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listLocations } from '@/lib/campus/queries'
import { dayOrder, locationFormLabels, locationName } from '@/lib/campus/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { departmentOptions } from '@/lib/staff/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function NewCampusLocationPage({ params }: PageProps<'/[lang]/app/[tenant]/campus/manage/new'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'campus.manage', feature: 'campus_assistant' })
  if (!ctx.tenantId || !writeMode(ctx, dict).canWrite) notFound()
  const m = dict.campus.manage
  const [locations, departments] = await Promise.all([listLocations(ctx.tenantId), listDepartments(ctx.tenantId)])

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/campus/manage`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {m.back}
      </Link>
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>{m.create}</CardTitle>
        </CardHeader>
        <CardContent>
          <LocationForm
            tenant={slug}
            locale={locale}
            buildings={locations.filter((l) => l.kind === 'building').map((l) => ({ value: l.id, label: locationName(locale, l) }))}
            departments={departmentOptions(locale, departments)}
            dayOrder={dayOrder(locale)}
            labels={{ ...locationFormLabels(dict), submit: m.createSubmit }}
            messages={formMessages(dict)}
          />
        </CardContent>
      </Card>
    </>
  )
}
