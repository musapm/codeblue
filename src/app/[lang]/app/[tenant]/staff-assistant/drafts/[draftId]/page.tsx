import { notFound } from 'next/navigation'
import { DraftView } from '@/components/staff/draft-view'
import { getI18n } from '@/lib/i18n/server'
import { writeMode } from '@/lib/management/view'
import { getDraft } from '@/lib/staff/queries'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** One of the caller's AI drafts (RLS: only the author can read it). */
export default async function StaffDraftPage({ params }: PageProps<'/[lang]/app/[tenant]/staff-assistant/drafts/[draftId]'>) {
  const { tenant: slug, draftId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.staff.use', feature: 'staff_assistant' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const draft = await getDraft(ctx.tenantId, draftId)
  if (!draft) notFound()
  return <DraftView draft={draft} slug={slug} locale={locale} dict={dict} canDelete={writeMode(ctx, dict).canWrite} />
}
