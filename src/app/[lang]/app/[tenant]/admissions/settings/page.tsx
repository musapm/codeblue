import { notFound } from 'next/navigation'
import { AdmissionsAssistantForm, AdmissionsSettingsForm } from '@/components/admissions/staff-forms'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAiConfig } from '@/lib/ai/config'
import { getAdmissionsSettings } from '@/lib/admissions/queries'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission } from '@/lib/tenancy/context'

export default async function AdmissionsSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/admissions/settings'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const canPage = hasWorkspacePermission(ctx, 'programs.manage')
  const canAssistant = hasWorkspacePermission(ctx, 'assistant.configure')
  if (!canPage && !canAssistant) notFound()
  const a = dict.admissions
  const s = a.settings
  const { canWrite, notice } = writeMode(ctx, dict)
  const settings = ctx.tenantId ? await getAdmissionsSettings(ctx.tenantId) : null
  const messages = formMessages(dict)
  const university = ctx.tenant.name
  const ai = getAiConfig()

  return (
    <div className="space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      <Alert variant="info">{s.visitorSessions}</Alert>

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>{s.publicHeading}</CardTitle>
            {settings ? <Badge variant={settings.public_enabled ? 'success' : 'neutral'}>{settings.public_enabled ? dict.management.assistant.settings.on : dict.management.assistant.settings.off}</Badge> : null}
          </div>
          <CardDescription>{s.publicDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWrite && canPage ? (
            <AdmissionsSettingsForm
              hidden={{ tenant: slug }}
              initial={{
                publicEnabled: settings?.public_enabled ?? false,
                contactEmail: settings?.contact_email ?? null,
                privacyUrl: settings?.privacy_url ?? null,
                welcome: settings?.welcome ?? null,
                welcomeAr: settings?.welcome_ar ?? null,
                consentText: settings?.consent_text ?? null,
                consentTextAr: settings?.consent_text_ar ?? null,
              }}
              messages={messages}
              labels={{
                publicEnabled: s.publicEnabled,
                contactEmail: s.contactEmail,
                contactEmailHint: s.contactEmailHint,
                privacyUrl: s.privacyUrl,
                privacyUrlHint: s.privacyUrlHint,
                welcome: s.welcome,
                welcomeAr: s.welcomeAr,
                consent: s.consent,
                consentAr: s.consentAr,
                consentHint: s.consentHint,
                optional: dict.common.optional,
                save: s.save,
                saving: dict.management.saving,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{s.noPermission}</p>
          )}
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">{s.defaultConsent}</p>
            <p className="mt-1">{a.public.defaultConsent(university)}</p>
            {settings?.consent_text || settings?.consent_text_ar ? (
              <p className="mt-2 text-xs text-muted-foreground">{s.currentVersion(String(settings.consent_version))}</p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{s.currentVersion('default-1')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>{s.assistantHeading}</CardTitle>
            {settings ? <Badge variant={settings.assistant_enabled ? 'success' : 'neutral'}>{settings.assistant_enabled ? dict.management.assistant.settings.on : dict.management.assistant.settings.off}</Badge> : null}
            <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
              {dict.management.assistant.settings.model(ai.model)}
            </span>
          </div>
          <CardDescription>{s.assistantDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!ai.configured ? <Alert variant="warning">{s.notConfigured}</Alert> : null}
          {settings && !settings.public_enabled ? <Alert variant="info">{s.needsPublic}</Alert> : null}
          {canWrite && canAssistant ? (
            <AdmissionsAssistantForm
              hidden={{ tenant: slug }}
              initial={{
                enabled: settings?.assistant_enabled ?? false,
                instructions: settings?.assistant_instructions ?? null,
                monthlyBudgetUsd: settings ? Number(settings.monthly_budget_usd) : 20,
                dailyQuestions: settings?.daily_questions_per_visitor ?? 20,
              }}
              messages={messages}
              labels={{
                enabled: s.assistantEnabled,
                instructions: s.instructions,
                instructionsHint: s.instructionsHint,
                budget: s.budget,
                budgetHint: s.budgetHint,
                daily: s.daily,
                dailyHint: s.dailyHint,
                optional: dict.common.optional,
                save: s.saveAssistant,
                saving: dict.management.saving,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{s.noPermission}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
