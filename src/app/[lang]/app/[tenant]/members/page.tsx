import { Shield, UserMinus, X } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { InviteForm } from '@/components/management/invite-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Avatar, EmptyState } from '@/components/ui/misc'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments, listInvitations, listMembers, listRoles, type RoleRow } from '@/lib/management/queries'
import { formatDate, formMessages, roleLabel, writeMode } from '@/lib/management/view'
import { changeMemberDepartment, changeMemberRole, removeMember, revokeInvitation, setMemberStatus } from '@/lib/management/workspace-actions'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

const STATUS_VARIANT = { active: 'success', invited: 'info', suspended: 'warning' } as const

export default async function MembersPage({ params }: PageProps<'/[lang]/app/[tenant]/members'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'members.read' })
  const m = dict.management
  const t = m.members
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)

  const can = {
    invite: canWrite && hasWorkspacePermission(ctx, 'members.invite'),
    manage: canWrite && hasWorkspacePermission(ctx, 'members.manage'),
    roles: canWrite && hasWorkspacePermission(ctx, 'roles.manage'),
    seeInvitations: hasWorkspacePermission(ctx, 'members.invite') || hasWorkspacePermission(ctx, 'members.manage'),
  }
  const isOwner = ctx.roles.includes('university_owner')

  const tenantId = ctx.tenantId
  const [members, invitations, roles, departments] = tenantId
    ? await Promise.all([listMembers(slug), can.seeInvitations ? listInvitations(slug) : Promise.resolve([]), listRoles(tenantId), listDepartments(tenantId)])
    : [[], [], [] as RoleRow[], []]

  // Roles the caller may invite into (mirrors app.can_grant_role; the database decides).
  const own = ctx.access.kind === 'scoped' ? ctx.access.permissions : null
  const invitable = roles.filter((r) => {
    if (r.key === 'university_owner') return isOwner
    if (hasWorkspacePermission(ctx, 'roles.manage')) return true
    return own ? r.permissions.every((p) => own.has(p)) : false
  })
  const rolesById = new Map(roles.map((r) => [r.id, r]))
  const roleByKey = new Map(roles.map((r) => [r.key, r]))
  const activeDepartments = departments.filter((d) => !d.archivedAt)
  const deptName = (id: string) => {
    const d = departments.find((x) => x.id === id)
    return d ? (locale === 'ar' && d.nameAr) || d.name : id.slice(0, 8)
  }
  const hidden = { tenant: slug, tenantId: tenantId ?? undefined, locale }

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <div className="space-y-6">
        {can.invite ? (
          <Card>
            <CardHeader>
              <CardTitle>{t.invite.heading}</CardTitle>
              <CardDescription>{t.invite.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <InviteForm
                tenantSlug={slug}
                locale={locale}
                roles={invitable.map((r) => ({ key: r.key, label: roleLabel(dict, r.key, r.name) }))}
                defaultRole="student"
                messages={messages}
                labels={{
                  email: t.invite.email,
                  role: t.invite.role,
                  validity: t.invite.validity,
                  submit: t.invite.submit,
                  submitting: t.invite.submitting,
                  noEmailYet: t.invite.noEmailYet,
                  createdTemplate: t.invite.created('{email}'),
                  expiresTemplate: t.invite.expires('{date}'),
                  copyOnce: t.invite.copyOnce,
                  copy: t.invite.copy,
                  copied: t.invite.copied,
                  link: t.invite.link,
                  dayOptions: [1, 3, 7, 14, 30].map((n) => ({ value: n, label: t.invite.days(n) })),
                }}
              />
              {!hasWorkspacePermission(ctx, 'roles.manage') ? <p className="text-xs text-muted-foreground">{t.invite.escalationNote}</p> : null}
            </CardContent>
          </Card>
        ) : null}

        {can.seeInvitations ? (
          <Card>
            <CardHeader>
              <CardTitle>{t.pending.heading}</CardTitle>
            </CardHeader>
            <CardContent>
              {invitations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.pending.empty}</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="ltr">
                        {inv.email}
                      </span>
                      <Badge variant="primary">{roleLabel(dict, inv.role_key, inv.role_name)}</Badge>
                      {inv.expired ? (
                        <Badge variant="warning">{t.pending.expired}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t.pending.expires}: {formatDate(locale, inv.expires_at, true)}
                        </span>
                      )}
                      {canWrite ? (
                        <ActionButton
                          action={revokeInvitation}
                          hidden={{ invitationId: inv.id }}
                          messages={messages}
                          confirmMessage={m.confirm.revoke}
                          label={t.pending.revoke}
                          ariaLabel={`${t.pending.revoke}: ${inv.email}`}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>{t.list.heading}</CardTitle>
            <span className="text-sm text-muted-foreground">{t.list.count(members.length)}</span>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <EmptyState title={t.list.empty} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {members.map((member) => {
                  const isSelf = member.user_id === ctx.user.id
                  const memberIsOwner = member.role_keys.includes('university_owner')
                  const protectedOwner = memberIsOwner && !isOwner
                  const name = member.full_name || member.email || t.list.noName
                  const memberRoleIds = member.role_keys.map((k) => roleByKey.get(k)?.id).filter(Boolean) as string[]
                  const addableRoles = roles.filter((r) => !memberRoleIds.includes(r.id) && (r.key !== 'university_owner' || isOwner))
                  const addableDepartments = activeDepartments.filter((d) => !member.department_ids.includes(d.id))
                  const showManage = (can.roles || can.manage) && !protectedOwner

                  return (
                    <li key={member.membership_id} className="space-y-3 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Avatar label={name} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-sm font-medium">
                            {name}
                            {isSelf ? <Badge variant="outline">{m.you}</Badge> : null}
                          </p>
                          {member.full_name && member.email ? (
                            <p className="truncate text-xs text-muted-foreground" dir="ltr">
                              {member.email}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant={STATUS_VARIANT[member.status]}>{m.memberStatus[member.status]}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {t.list.joined}: {formatDate(locale, member.joined_at)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 ps-11">
                        {member.role_keys.length === 0 ? <span className="text-xs text-muted-foreground">{m.none}</span> : null}
                        {member.role_keys.map((key) => {
                          const role = roleByKey.get(key)
                          const label = roleLabel(dict, key, role?.name)
                          // Owners hand over ownership by adding another owner first; nobody demotes themselves here.
                          const removable = can.roles && role && !protectedOwner && (key !== 'university_owner' || (isOwner && !isSelf))
                          return removable ? (
                            <ActionButton
                              key={key}
                              action={changeMemberRole}
                              hidden={{ ...hidden, membershipId: member.membership_id, roleId: role.id, op: 'remove' }}
                              messages={messages}
                              label={label}
                              icon={key === 'university_owner' ? <Shield aria-hidden /> : undefined}
                              ariaLabel={t.list.removeRole(label)}
                              variant="subtle"
                              className="[&_button]:h-7 [&_button]:rounded-full [&_button]:px-2.5 [&_button]:text-xs"
                            />
                          ) : (
                            <Badge key={key} variant="primary">
                              {key === 'university_owner' ? <Shield aria-hidden className="size-3" /> : null}
                              {label}
                            </Badge>
                          )
                        })}
                        {member.department_ids.map((id) =>
                          can.manage && !protectedOwner ? (
                            <ActionButton
                              key={id}
                              action={changeMemberDepartment}
                              hidden={{ ...hidden, membershipId: member.membership_id, departmentId: id, op: 'remove' }}
                              messages={messages}
                              label={deptName(id)}
                              icon={<X aria-hidden />}
                              ariaLabel={t.list.removeDepartment(deptName(id))}
                              variant="ghost"
                              className="[&_button]:h-7 [&_button]:rounded-full [&_button]:border [&_button]:border-border [&_button]:px-2.5 [&_button]:text-xs"
                            />
                          ) : (
                            <Badge key={id} variant="outline">
                              {deptName(id)}
                            </Badge>
                          ),
                        )}
                      </div>

                      {protectedOwner && (can.roles || can.manage) ? <p className="ps-11 text-xs text-muted-foreground">{t.list.ownerNote}</p> : null}

                      {showManage ? (
                        <details className="ms-11 rounded-lg border border-border bg-muted/30 open:bg-background">
                          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t.list.manage}</summary>
                          <div className="flex flex-wrap items-end gap-4 border-t border-border px-3 py-3">
                            {can.roles && addableRoles.length > 0 ? (
                              <ActionForm action={changeMemberRole} hidden={{ ...hidden, membershipId: member.membership_id, op: 'add' }} messages={messages} showSuccess={false} className="space-y-2">
                                <label className="block text-xs font-medium text-muted-foreground" htmlFor={`role-${member.membership_id}`}>
                                  {t.list.addRole}
                                </label>
                                <div className="flex gap-2">
                                  <Select id={`role-${member.membership_id}`} name="roleId" className="h-8 w-52 text-xs" required defaultValue="">
                                    <option value="" disabled>
                                      {t.list.chooseRole}
                                    </option>
                                    {addableRoles.map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {roleLabel(dict, r.key, rolesById.get(r.id)?.name)}
                                      </option>
                                    ))}
                                  </Select>
                                  <SubmitButton size="sm" variant="secondary">
                                    {m.add}
                                  </SubmitButton>
                                </div>
                              </ActionForm>
                            ) : null}

                            {can.manage && addableDepartments.length > 0 ? (
                              <ActionForm action={changeMemberDepartment} hidden={{ ...hidden, membershipId: member.membership_id, op: 'add' }} messages={messages} showSuccess={false} className="space-y-2">
                                <label className="block text-xs font-medium text-muted-foreground" htmlFor={`dept-${member.membership_id}`}>
                                  {t.list.addDepartment}
                                </label>
                                <div className="flex gap-2">
                                  <Select id={`dept-${member.membership_id}`} name="departmentId" className="h-8 w-52 text-xs" required defaultValue="">
                                    <option value="" disabled>
                                      {t.list.chooseDepartment}
                                    </option>
                                    {addableDepartments.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {(locale === 'ar' && d.nameAr) || d.name}
                                      </option>
                                    ))}
                                  </Select>
                                  <SubmitButton size="sm" variant="secondary">
                                    {m.add}
                                  </SubmitButton>
                                </div>
                              </ActionForm>
                            ) : null}

                            {can.manage && !isSelf ? (
                              <div className="flex flex-wrap gap-2">
                                <ActionButton
                                  action={setMemberStatus}
                                  hidden={{ ...hidden, membershipId: member.membership_id, status: member.status === 'suspended' ? 'active' : 'suspended' }}
                                  messages={messages}
                                  confirmMessage={member.status === 'suspended' ? undefined : m.confirm.suspend}
                                  label={member.status === 'suspended' ? t.list.reactivate : t.list.suspend}
                                />
                                <ActionButton
                                  action={removeMember}
                                  hidden={{ ...hidden, membershipId: member.membership_id }}
                                  messages={messages}
                                  confirmMessage={m.confirm.remove}
                                  label={t.list.removeMember}
                                  icon={<UserMinus aria-hidden />}
                                  variant="danger"
                                />
                              </div>
                            ) : null}
                            {isSelf && can.manage ? <p className="text-xs text-muted-foreground">{t.list.selfNote}</p> : null}
                          </div>
                        </details>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.rolesCard.heading}</CardTitle>
            <CardDescription>{t.rolesCard.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {roles.map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{roleLabel(dict, r.key, r.name)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.roleDescriptions[r.key] ?? r.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{t.rolesCard.permissions(r.permissions.length)}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
