'use client'

import { Search } from 'lucide-react'
import { useActionState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import type { FormMessages } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { testKnowledgeSearch, type SearchHit } from '@/lib/knowledge/actions'
import { idleState, type ActionState } from '@/lib/management/action-state'

export type SearchLabels = {
  query: string
  submit: string
  empty: string
  score: string
  /** Pre-rendered with {from} / {to}. */
  pageSingle: string
  pageRange: string
  visibility: Record<string, string>
}

export function KnowledgeSearchPanel({ tenant, locale, labels, messages }: { tenant: string; locale: string; labels: SearchLabels; messages: FormMessages }) {
  const [state, action] = useActionState(testKnowledgeSearch, idleState as ActionState<SearchHit[]>)
  const qError = state.status === 'error' && state.fieldErrors?.q ? messages.validation[state.fieldErrors.q] : undefined
  const page = (h: SearchHit) =>
    h.page_from == null ? null : h.page_from === h.page_to || h.page_to == null ? labels.pageSingle.replace('{from}', String(h.page_from)) : labels.pageRange.replace('{from}', String(h.page_from)).replace('{to}', String(h.page_to))

  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-start gap-2" role="search">
        <input type="hidden" name="tenant" value={tenant} />
        <label htmlFor="knowledge-q" className="sr-only">
          {labels.query}
        </label>
        <div className="min-w-0 flex-1 space-y-1">
          <Input id="knowledge-q" name="q" placeholder={labels.query} maxLength={500} required aria-invalid={qError ? true : undefined} />
          {qError ? <p className="text-xs font-medium text-danger">{qError}</p> : null}
        </div>
        <SubmitButton variant="secondary">
          <Search aria-hidden />
          {labels.submit}
        </SubmitButton>
      </form>
      {state.status === 'error' && !qError ? (
        <Alert variant="danger" role="alert">
          {messages.errors[state.error]}
        </Alert>
      ) : null}
      {state.status === 'success' ? (
        state.data && state.data.length > 0 ? (
          <ol className="space-y-3" aria-live="polite">
            {state.data.map((h) => (
              <li key={h.chunk_id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{(locale === 'ar' && h.title_ar) || h.title}</span>
                  {page(h) ? <span className="text-xs text-muted-foreground">{page(h)}</span> : null}
                  {h.heading ? <span className="text-xs text-muted-foreground">· {h.heading}</span> : null}
                  <Badge variant="outline">{labels.visibility[h.visibility] ?? h.visibility}</Badge>
                  <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                    {labels.score} {h.score.toFixed(4)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-4 text-sm whitespace-pre-line text-muted-foreground" dir="auto">
                  {h.content}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {labels.empty}
          </p>
        )
      ) : null}
    </div>
  )
}
