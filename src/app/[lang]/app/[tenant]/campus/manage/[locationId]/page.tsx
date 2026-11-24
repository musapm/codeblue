import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Eye, EyeOff, Trash2 } from 'lucide-react'
import { LocationForm } from '@/components/campus/location-form'
import { ActionButton } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteLocationAction, setPublishedAction } from '@/lib/campus/actions'
import { getLocation, listLocations } from '@/lib/campus/queries'
import { dayOrder, locationFormLabels, locationName, toFormValues } from '@/lib/campus/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { departmentOptions } from '@/lib/staff/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function EditCampusLocationPage({ params }: PageProps<'/[lang]/app/[tenant]/campus/manage/[locationId]'>) {
  const { tenant: slug, locationId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'campus.manage', feature: 'campus_assistant' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const [l, locations, departments] = await Promise.all([getLocation(ctx.tenantId, locationId), listLocations(ctx.tenantId), listDepartments(ctx.tenantId)])
  if (!l) notFound()
  const m = dict.campus.manage
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)
  const hidden = { tenant: slug, locale, locationId: l.id }

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/campus/manage`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {m.back}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold" dir="auto">
          {locationName(locale, l)}
        </h2>
        <Badge variant={l.published ? 'success' : 'neutral'}>{l.published ? m.published : m.draft}</Badge>
        <Link href={localizedPath(locale, `/app/${slug}/campus/${l.id}`)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          {m.view}
        </Link>
      </div>
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      {canWrite ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <ActionButton
            action={setPublishedAction}
            hidden={{ locationId: l.id, published: l.published ? 'false' : 'true' }}
            messages={messages}
            label={l.published ? m.unpublish : m.publish}
            variant={l.published ? 'secondary' : 'primary'}
            size="md"
            icon={l.published ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          />
          <ActionButton action={deleteLocationAction} hidden={hidden} messages={messages} confirmMessage={m.confirmDelete} label={m.delete} variant="ghost" size="md" icon={<Trash2 aria-hidden />} />
        </div>
      ) : null}
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle className="text-base">{m.sections.basics}</CardTitle>
        </CardHeader>
        <CardContent>
          {canWrite ? (
            <LocationForm
              tenant={slug}
              locale={locale}
              locationId={l.id}
              initial={toFormValues(l)}
              buildings={locations.filter((b) => b.kind === 'building' && b.id !== l.id).map((b) => ({ value: b.id, label: locationName(locale, b) }))}
              departments={departmentOptions(locale, departments)}
              dayOrder={dayOrder(locale)}
              labels={locationFormLabels(dict)}
              messages={messages}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{notice}</p>
          )}
        </CardContent>
      </Card>
    </>
  )
}
