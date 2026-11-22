import { BrandingEditor } from '@/components/branding/branding-editor'
import { ActionButton } from '@/components/management/action-form'
import { LogoUpload } from '@/components/management/logo-upload'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { logoPublicUrl } from '@/lib/branding/logo'
import { resolveTheme } from '@/lib/branding/theme'
import { getI18n } from '@/lib/i18n/server'
import { getBranding } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { saveBranding } from '@/lib/management/workspace-actions'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export default async function BrandingSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/settings/branding'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tenant.branding.manage' })
  const { tenant } = ctx
  const t = dict.workspace.settings.branding
  const b = dict.management.branding
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)

  const branding = ctx.tenantId ? await getBranding(ctx.tenantId) : null
  // Edit the draft when one exists, otherwise start from what is published.
  const source = branding ? (branding.draft ?? branding.published) : null
  const colors = source ? resolveTheme(source) : tenant.colors
  const initial = {
    ...colors,
    assistantName: source ? str(source.assistant_name) : tenant.assistantName,
    assistantNameAr: source ? str(source.assistant_name_ar) : '',
    welcome: source ? str(source.welcome) : tenant.welcome,
    welcomeAr: source ? str(source.welcome_ar) : '',
    monogram: source ? str(source.monogram) : '',
  }
  const status = !branding
    ? ''
    : branding.draft
      ? b.draftStatus
      : branding.publishedAt
        ? b.publishedStatus(formatDate(locale, branding.publishedAt, true))
        : b.neverPublished
  const logoUrl = logoPublicUrl(source?.logo_path)
  const hidden = { tenant: slug, tenantId: ctx.tenantId ?? undefined, locale }

  return (
    <div className="space-y-6">
      <BrandingEditor
        // Remount when switching tenants or after a save so the form shows stored values.
        key={`${tenant.slug}:${branding?.updatedAt ?? ''}`}
        initial={initial}
        fallbacks={{ assistantName: dict.workspace.defaultAssistantName(tenant.name), welcome: dict.workspace.defaultWelcome }}
        universityName={tenant.name}
        monogram={tenant.monogram}
        logoUrl={logoUrl}
        locale={locale}
        hidden={hidden}
        canSave={canWrite}
        readOnlyNotice={notice}
        messages={messages}
        labels={{
          heading: t.heading,
          description: t.description,
          primary: t.primary,
          secondary: t.secondary,
          accent: t.accent,
          assistantName: t.assistantName,
          assistantNameAr: b.assistantNameAr,
          welcome: t.welcome,
          welcomeAr: b.welcomeAr,
          monogram: b.monogram,
          monogramHint: b.monogramHint,
          optional: dict.common.optional,
          preview: t.preview,
          contrastOk: t.contrastOk,
          invalidHex: t.invalidHex,
          picker: t.picker,
          reset: t.reset,
          saveDraft: b.saveDraft,
          publish: b.publish,
          saving: b.publishing,
          status,
          publishedNote: b.publishedNote,
          sampleQuestion: t.sampleQuestion,
          sampleAnswerNote: t.sampleAnswerNote,
          askPlaceholder: t.askPlaceholder,
          pairs: t.pairs,
          contrastIssueTemplate: t.contrastIssue('{pair}', '{ratio}', '{minimum}'),
        }}
      />

      {canWrite ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>{b.logo.heading}</CardTitle>
            <CardDescription>{b.logo.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{b.logo.current}</p>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={b.logo.current} className="size-24 rounded-lg border border-border bg-white object-contain p-1" />
              ) : (
                <p className="flex size-24 items-center justify-center rounded-lg border border-dashed border-border p-2 text-center text-xs text-muted-foreground">
                  {b.logo.none}
                </p>
              )}
            </div>
            <div className="space-y-4">
              <LogoUpload hidden={hidden} messages={messages} labels={{ choose: b.logo.choose, upload: b.logo.upload, uploading: b.logo.uploading, draftNote: b.logo.draftNote }} />
              {logoUrl ? (
                <ActionButton
                  action={saveBranding}
                  messages={messages}
                  label={b.logo.remove}
                  variant="ghost"
                  hidden={{
                    ...hidden,
                    removeLogo: 'true',
                    intent: 'draft',
                    primary: colors.primary,
                    secondary: colors.secondary,
                    accent: colors.accent,
                    assistantName: initial.assistantName || undefined,
                    assistantNameAr: initial.assistantNameAr || undefined,
                    welcome: initial.welcome || undefined,
                    welcomeAr: initial.welcomeAr || undefined,
                    monogram: initial.monogram || undefined,
                  }}
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
