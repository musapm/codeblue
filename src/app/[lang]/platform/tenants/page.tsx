import Link from 'next/link'
import { ArrowRight, Building2 } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { CreateTenantForm } from '@/components/management/create-tenant-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listPlatformTenants } from '@/lib/management/queries'
import { formatDate, formMessages, TENANT_STATUS_VARIANT as STATUS_VARIANT } from '@/lib/management/view'
import { requirePlatformAccess } from '@/lib/tenancy/context'

export default async function PlatformTenantsPage() {
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  const m = dict.management
  const t = m.platform.tenants
  const c = m.platform.create
  const canManage = !user.isPreview && (role === 'owner' || role === 'admin')
  const tenants = user.isPreview ? [] : await listPlatformTenants()
  const base = localizedPath(locale, '/platform/tenants')

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      {user.isPreview ? (
        <Alert variant="info" className="mb-6">
          {m.previewNotice}
        </Alert>
      ) : null}
      <div className="space-y-6">
        <Card>
          <CardContent>
            {tenants.length === 0 ? (
              <EmptyState icon={<Building2 />} title={t.empty} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-start font-medium">{t.name}</th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">{t.status}</th>
                      <th scope="col" className="px-4 py-2 text-end font-medium">{t.members}</th>
                      <th scope="col" className="px-4 py-2 text-end font-medium">{t.invitations}</th>
                      <th scope="col" className="px-4 py-2 text-end font-medium">{t.features}</th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">{t.created}</th>
                      <th scope="col" className="px-4 py-2"><span className="sr-only">{t.open}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenants.map((tn) => (
                      <tr key={tn.id}>
                        <td className="px-4 py-3">
                          <p className="flex items-center gap-2 font-medium">
                            {(locale === 'ar' && tn.name_translations.ar) || tn.name}
                            {tn.is_demo ? <Badge variant="outline">{t.demo}</Badge> : null}
                          </p>
                          <p className="text-xs text-muted-foreground" dir="ltr">{tn.slug}</p>
                        </td>
                        <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[tn.status]}>{m.tenantStatus[tn.status]}</Badge></td>
                        <td className="px-4 py-3 text-end tabular-nums">{tn.member_count}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{tn.pending_invitations}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{tn.features_enabled}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(locale, tn.created_at)}</td>
                        <td className="px-4 py-3 text-end">
                          <Link href={`${base}/${tn.slug}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                            {t.open}
                            <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {canManage ? (
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>{c.heading}</CardTitle>
              <CardDescription>{c.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateTenantForm
                locale={locale}
                detailBase={base}
                messages={formMessages(dict)}
                labels={{
                  name: c.name,
                  nameAr: c.nameAr,
                  slug: c.slug,
                  slugHint: c.slugHint,
                  defaultLanguage: c.defaultLanguage,
                  timezone: c.timezone,
                  isDemo: c.isDemo,
                  ownerEmail: c.ownerEmail,
                  ownerHint: c.ownerHint,
                  optional: dict.common.optional,
                  submit: c.submit,
                  submitting: c.submitting,
                  createdTemplate: c.created('{slug}'),
                  ownerLinkTemplate: c.ownerLink('{email}'),
                  view: c.view,
                  copy: m.members.invite.copy,
                  copied: m.members.invite.copied,
                  link: m.members.invite.link,
                  languages: m.settings.languages,
                }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
