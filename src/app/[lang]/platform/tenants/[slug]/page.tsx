import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CreditCard, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { InviteForm } from '@/components/management/invite-form'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, Textarea } from '@/components/ui/input'
import { BILLING_ROLES } from '@/lib/billing/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { grantSupportAccess, revokeSupportAccess, setTenantFeature, setTenantStatus } from '@/lib/management/platform-actions'
import { getPlatformTenant, listInvitations, listPlatformStaff } from '@/lib/management/queries'
import { formatDate, formMessages, roleLabel, TENANT_STATUS_VARIANT } from '@/lib/management/view'
import { revokeInvitation } from '@/lib/management/workspace-actions'
import { listWorkspacesForUser, requirePlatformAccess } from '@/lib/tenancy/context'

const STATUSES = ['trial', 'active', 'suspended', 'archived'] as const

export default async function PlatformTenantPage({ params }: PageProps<'/[lang]/platform/tenants/[slug]'>) {
  const { slug } = await params
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  if (user.isPreview) notFound() // preview has no tenants behind this page
  const m = dict.management
  const d = m.platform.detail
  const messages = formMessages(dict)
  const canManage = role === 'owner' || role === 'admin'

  const tenant = await getPlatformTenant(slug)
  if (!tenant) notFound()
  const [invitations, staff, { workspaces }] = await Promise.all([
    canManage ? listInvitations(slug) : Promise.resolve([]),
    canManage ? listPlatformStaff() : Promise.resolve([]),
    listWorkspacesForUser(locale),
  ])
  const staffName = new Map(staff.map((s) => [s.user_id, s.full_name || s.email || s.user_id.slice(0, 8)]))
  const isMember = workspaces.some((w) => w.slug === tenant.slug)
  const hidden = { slug: tenant.slug, tenantId: tenant.id, locale }
  const displayName = (locale === 'ar' && tenant.nameAr) || tenant.name

  return (
    <>
      <Link href={localizedPath(locale, '/platform/tenants')} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {d.back}
      </Link>
      <PageHeader
        title={displayName}
        badge={
          <>
            <Badge variant={TENANT_STATUS_VARIANT[tenant.status]}>{m.tenantStatus[tenant.status]}</Badge>
            {tenant.isDemo ? <Badge variant="outline">{m.platform.tenants.demo}</Badge> : null}
          </>
        }
        actions={
          <span className="flex flex-wrap gap-2">
            {BILLING_ROLES.includes(role ?? '') ? (
              <Link href={localizedPath(locale, `/platform/tenants/${tenant.slug}/subscription`)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                <CreditCard aria-hidden />
                {dict.billing.subscription.link}
              </Link>
            ) : null}
            {isMember ? (
              <Link href={localizedPath(locale, `/app/${tenant.slug}`)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                <ExternalLink aria-hidden />
                {d.openWorkspace}
              </Link>
            ) : null}
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{d.overview}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
              {[
                { label: d.slug, value: `/app/${tenant.slug}`, ltr: true },
                { label: d.language, value: m.settings.languages[tenant.defaultLocale === 'ar' ? 'ar' : 'en'] },
                { label: d.timezone, value: tenant.timezone, ltr: true },
                { label: d.created, value: formatDate(locale, tenant.createdAt, true) },
              ].map((row) => (
                <div key={row.label} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium" dir={row.ltr ? 'ltr' : undefined}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            {canManage ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">{d.statusHeading}</h3>
                <p className="text-xs text-muted-foreground">{d.statusDescription}</p>
                <ActionForm action={setTenantStatus} hidden={hidden} messages={messages} confirmMessage={m.confirm.status} className="flex flex-wrap items-end gap-3 space-y-0">
                  <label className="sr-only" htmlFor="tenant-status">
                    {d.statusHeading}
                  </label>
                  <Select id="tenant-status" name="status" defaultValue={tenant.status} className="w-48">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {m.tenantStatus[s]}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton variant="secondary">{d.changeStatus}</SubmitButton>
                </ActionForm>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{d.featuresHeading}</CardTitle>
            <CardDescription>{d.featuresDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {tenant.features.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-medium" dir="ltr">
                      {f.key}
                    </p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                  <Badge variant="outline">{d.phase(f.plannedPhase)}</Badge>
                  {canManage ? (
                    <ActionButton
                      action={setTenantFeature}
                      hidden={{ ...hidden, featureKey: f.key, enabled: f.enabled ? 'false' : 'true' }}
                      messages={messages}
                      label={f.enabled ? d.on : d.off}
                      ariaLabel={f.enabled ? d.turnOff(f.key) : d.turnOn(f.key)}
                      variant={f.enabled ? 'subtle' : 'secondary'}
                    />
                  ) : (
                    <Badge variant={f.enabled ? 'success' : 'neutral'}>{f.enabled ? d.on : d.off}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>{d.inviteHeading}</CardTitle>
              <CardDescription>{d.inviteDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <InviteForm
                tenantSlug={tenant.slug}
                locale={locale}
                roles={['university_owner', 'university_admin'].map((key) => ({ key, label: roleLabel(dict, key) }))}
                defaultRole="university_owner"
                messages={messages}
                labels={{
                  email: m.members.invite.email,
                  role: m.members.invite.role,
                  validity: m.members.invite.validity,
                  submit: m.members.invite.submit,
                  submitting: m.members.invite.submitting,
                  noEmailYet: m.members.invite.noEmailYet,
                  createdTemplate: m.members.invite.created('{email}'),
                  expiresTemplate: m.members.invite.expires('{date}'),
                  copyOnce: m.members.invite.copyOnce,
                  copy: m.members.invite.copy,
                  copied: m.members.invite.copied,
                  link: m.members.invite.link,
                  dayOptions: [1, 3, 7, 14, 30].map((n) => ({ value: n, label: m.members.invite.days(n) })),
                }}
              />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">{m.members.pending.heading}</h3>
                {invitations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{m.members.pending.empty}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {invitations.map((inv) => (
                      <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-sm" dir="ltr">
                          {inv.email}
                        </span>
                        <Badge variant="primary">{roleLabel(dict, inv.role_key, inv.role_name)}</Badge>
                        {inv.expired ? <Badge variant="warning">{m.members.pending.expired}</Badge> : null}
                        <ActionButton
                          action={revokeInvitation}
                          hidden={{ invitationId: inv.id }}
                          messages={messages}
                          confirmMessage={m.confirm.revoke}
                          label={m.members.pending.revoke}
                          ariaLabel={`${m.members.pending.revoke}: ${inv.email}`}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{d.supportHeading}</CardTitle>
            <CardDescription>{d.supportDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {canManage && staff.length > 0 ? (
              <ActionForm action={grantSupportAccess} hidden={hidden} messages={messages} resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                  <FormField name="granteeId" label={d.grantee}>
                    <Select name="granteeId" required defaultValue={staff[0]?.user_id}>
                      {staff.map((s) => (
                        <option key={s.user_id} value={s.user_id}>
                          {staffName.get(s.user_id)} ({s.role})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField name="hours" label={d.hours}>
                    <Select name="hours" defaultValue="2">
                      {[1, 2, 4, 8, 24].map((n) => (
                        <option key={n} value={n}>
                          {d.hoursOption(n)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
                <FormField name="reason" label={d.reason} hint={d.reasonHint}>
                  <Textarea name="reason" required minLength={10} maxLength={500} rows={2} />
                </FormField>
                <SubmitButton variant="secondary">{d.grant}</SubmitButton>
              </ActionForm>
            ) : null}

            {tenant.supportGrants.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d.noGrants}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {tenant.supportGrants.map((g) => {
                  const active = g.active
                  return (
                    <li key={g.id} className="space-y-1 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{staffName.get(g.granteeId) ?? g.granteeId.slice(0, 8)}</span>
                        <Badge variant={active ? 'warning' : 'neutral'}>{active ? d.active : g.revokedAt ? d.revoked : d.ended}</Badge>
                        <span className="text-xs text-muted-foreground">{d.until(formatDate(locale, g.expiresAt, true))}</span>
                        {canManage && active ? (
                          <ActionButton action={revokeSupportAccess} hidden={{ grantId: g.id }} messages={messages} label={d.revoke} className="ms-auto" />
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{g.reason}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
