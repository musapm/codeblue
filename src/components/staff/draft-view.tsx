import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { OpenMaterialButton } from '@/components/academic/study'
import { ActionButton } from '@/components/management/action-form'
import { CopyButton } from '@/components/staff/drafts'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Locale } from '@/lib/i18n/config'
import { localizedPath } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import { formatDate, formMessages } from '@/lib/management/view'
import { deleteDraftAction } from '@/lib/staff/actions'
import type { Draft } from '@/lib/staff/queries'

/** One AI draft: text to copy, details still missing, the documents used (server component). */
export function DraftView({ draft, slug, locale, dict, canDelete }: { draft: Draft; slug: string; locale: Locale; dict: Dictionary; canDelete: boolean }) {
  const s = dict.staff
  const t = s.draft
  const dir = draft.language === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={localizedPath(locale, `/app/${slug}/staff-assistant/drafts`)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t.back}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold" dir="auto">
            {draft.title}
          </h2>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="info">{s.aiLabel}</Badge>
            <Badge variant="outline">{s.drafts.kinds[draft.kind] ?? draft.kind}</Badge>
            <span>{s.drafts.languages[draft.language]}</span>
            <span>{t.created(formatDate(locale, draft.createdAt, true))}</span>
          </p>
        </div>
        {canDelete ? (
          <ActionButton
            action={deleteDraftAction}
            hidden={{ tenant: slug, locale, draftId: draft.id }}
            messages={formMessages(dict)}
            confirmMessage={t.confirmDelete}
            label={t.delete}
            variant="ghost"
            icon={<Trash2 aria-hidden />}
          />
        ) : null}
      </div>

      <Alert variant="warning">{t.notice}</Alert>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardContent className="space-y-5 pt-6">
            {draft.content.subject ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t.subject}</h3>
                  <CopyButton text={draft.content.subject} labels={{ copy: t.copySubject, copied: t.copied }} />
                </div>
                <p className="rounded-lg border border-border bg-canvas px-4 py-2.5 text-sm" dir={dir} lang={draft.language}>
                  {draft.content.subject}
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t.body}</h3>
                <CopyButton text={draft.content.body} labels={{ copy: t.copy, copied: t.copied }} />
              </div>
              <div className="rounded-lg border border-border bg-canvas p-4 text-sm leading-relaxed whitespace-pre-wrap" dir={dir} lang={draft.language}>
                {draft.content.body}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {draft.content.missing.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.missing}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{t.missingHint}</p>
                <ul className="list-disc space-y-1 ps-5 text-sm">
                  {draft.content.missing.map((m, i) => (
                    <li key={i} dir="auto">
                      {m}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.sources}</CardTitle>
            </CardHeader>
            <CardContent>
              {draft.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noSources}</p>
              ) : (
                <ul className="space-y-2">
                  {draft.sources.map((src) => (
                    <li key={src.document_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate" dir="auto" title={(locale === 'ar' && src.title_ar) || src.title}>
                        {(locale === 'ar' && src.title_ar) || src.title}
                      </span>
                      <OpenMaterialButton documentId={src.document_id} labels={{ open: dict.academic.course.open, opening: dict.academic.course.opening }} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
