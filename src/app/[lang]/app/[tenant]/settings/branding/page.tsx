import { BrandingEditor } from '@/components/branding/branding-editor'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext } from '@/lib/tenancy/context'

export default async function BrandingSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/settings/branding'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const { tenant } = await getWorkspaceContext(locale, slug)
  const t = dict.workspace.settings.branding

  return (
    <BrandingEditor
      // Remount when switching tenants so the draft resets to that tenant's values.
      key={tenant.slug}
      initial={{ ...tenant.colors, assistantName: tenant.assistantName, welcome: tenant.welcome }}
      universityName={tenant.name}
      monogram={tenant.monogram}
      labels={{
        heading: t.heading,
        description: t.description,
        primary: t.primary,
        secondary: t.secondary,
        accent: t.accent,
        assistantName: t.assistantName,
        welcome: t.welcome,
        preview: t.preview,
        contrastOk: t.contrastOk,
        invalidHex: t.invalidHex,
        picker: t.picker,
        reset: t.reset,
        saveDisabled: t.saveDisabled,
        sampleQuestion: t.sampleQuestion,
        sampleAnswerNote: t.sampleAnswerNote,
        askPlaceholder: t.askPlaceholder,
        pairs: t.pairs,
        contrastIssueTemplate: t.contrastIssue('{pair}', '{ratio}', '{minimum}'),
      }}
    />
  )
}
