'use client'

import { CircleCheck, RotateCcw, TriangleAlert } from 'lucide-react'
import { useActionState, useId, useMemo, useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ChatPreview } from '@/components/marketing/chat-preview'
import type { FormMessages } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { assessThemeContrast, buildThemeVariables, parseHexColor, type ThemeColors } from '@/lib/branding/theme'
import { idleState, type ActionState } from '@/lib/management/action-state'
import { saveBranding } from '@/lib/management/workspace-actions'

export type BrandingDraft = ThemeColors & {
  assistantName: string
  assistantNameAr: string
  welcome: string
  welcomeAr: string
  monogram: string
}

type Labels = {
  heading: string
  description: string
  primary: string
  secondary: string
  accent: string
  assistantName: string
  assistantNameAr: string
  welcome: string
  welcomeAr: string
  monogram: string
  monogramHint: string
  optional: string
  preview: string
  contrastOk: string
  invalidHex: string
  picker: string
  reset: string
  saveDraft: string
  publish: string
  saving: string
  status: string
  publishedNote: string
  sampleQuestion: string
  sampleAnswerNote: string
  askPlaceholder: string
  pairs: Record<string, string>
  /** Pre-rendered with {pair} {ratio} {minimum} placeholders (functions can't cross to the client). */
  contrastIssueTemplate: string
}

const COLOR_KEYS = ['primary', 'secondary', 'accent'] as const

/**
 * Branding editor with a live preview powered by the tenant theme engine. Saves a draft
 * (validated by zod and again by the database) and publishes it on request. Without
 * `canSave` (preview mode, support access) it stays a preview and says so.
 */
export function BrandingEditor({
  initial,
  fallbacks,
  universityName,
  monogram,
  logoUrl,
  locale,
  hidden,
  canSave,
  readOnlyNotice,
  messages,
  labels,
}: {
  initial: BrandingDraft
  /** Shown in the preview (and as placeholders) when a text field is left empty. */
  fallbacks: { assistantName: string; welcome: string }
  universityName: string
  monogram: string
  logoUrl?: string
  locale: string
  hidden: Record<string, string | undefined>
  canSave: boolean
  readOnlyNotice?: string
  messages: FormMessages
  labels: Labels
}) {
  const [state, formAction] = useActionState(saveBranding, idleState as ActionState)
  const [draft, setDraft] = useState<BrandingDraft>(initial)
  const [raw, setRaw] = useState<Record<(typeof COLOR_KEYS)[number], string>>({
    primary: initial.primary,
    secondary: initial.secondary,
    accent: initial.accent,
  })

  const idPrefix = useId()
  const issues = useMemo(() => assessThemeContrast(draft), [draft])
  const themeStyle = useMemo(() => buildThemeVariables(draft), [draft])
  const anyInvalid = COLOR_KEYS.some((k) => parseHexColor(raw[k]) === null)

  const setColor = (key: (typeof COLOR_KEYS)[number], value: string) => {
    setRaw((r) => ({ ...r, [key]: value }))
    const parsed = parseHexColor(value)
    if (parsed) setDraft((d) => ({ ...d, [key]: parsed }))
  }

  const reset = () => {
    setDraft(initial)
    setRaw({ primary: initial.primary, secondary: initial.secondary, accent: initial.accent })
  }

  const text = (key: 'assistantName' | 'assistantNameAr' | 'welcome' | 'welcomeAr' | 'monogram') => ({
    name: key,
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value })),
  })
  const fieldError = (name: string) => {
    const key = state.status === 'error' ? state.fieldErrors?.[name] : undefined
    return key ? messages.validation[key] : undefined
  }
  const isAr = locale === 'ar'

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.heading}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-6" noValidate>
            {Object.entries(hidden).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
            {readOnlyNotice ? <Alert variant="info">{readOnlyNotice}</Alert> : <p className="text-sm text-muted-foreground">{labels.status}</p>}
            {state.status === 'error' ? (
              <Alert variant="danger" role="alert">
                {messages.errors[state.error]}
              </Alert>
            ) : null}
            {state.status === 'success' ? (
              <Alert variant="success" role="status">
                {messages.saved}
              </Alert>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-3">
              {COLOR_KEYS.map((key) => {
                const invalid = parseHexColor(raw[key]) === null
                const inputId = `${idPrefix}-${key}`
                const errorId = `${inputId}-error`
                const serverError = fieldError(key)
                return (
                  <div key={key} className="space-y-1.5">
                    <label htmlFor={inputId} className="block text-sm font-medium">
                      {labels[key]}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft[key]}
                        onChange={(e) => setColor(key, e.target.value)}
                        aria-label={`${labels[key]}: ${labels.picker}`}
                        className="size-10 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1"
                      />
                      <Input
                        id={inputId}
                        name={key}
                        type="text"
                        value={raw[key]}
                        onChange={(e) => setColor(key, e.target.value)}
                        maxLength={7}
                        spellCheck={false}
                        dir="ltr"
                        aria-invalid={invalid || Boolean(serverError) || undefined}
                        aria-describedby={invalid || serverError ? errorId : undefined}
                        className="font-mono"
                      />
                    </div>
                    {invalid || serverError ? (
                      <p id={errorId} className="text-xs font-medium text-danger">
                        {invalid ? labels.invalidHex : serverError}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={labels.assistantName} optionalLabel={labels.optional} error={fieldError('assistantName')}>
                <Input maxLength={60} placeholder={fallbacks.assistantName} {...text('assistantName')} />
              </Field>
              <Field label={labels.assistantNameAr} optionalLabel={labels.optional} error={fieldError('assistantNameAr')}>
                <Input maxLength={60} dir="rtl" lang="ar" {...text('assistantNameAr')} />
              </Field>
              <Field label={labels.welcome} optionalLabel={labels.optional} error={fieldError('welcome')}>
                <Textarea maxLength={280} rows={3} placeholder={fallbacks.welcome} {...text('welcome')} />
              </Field>
              <Field label={labels.welcomeAr} optionalLabel={labels.optional} error={fieldError('welcomeAr')}>
                <Textarea maxLength={280} rows={3} dir="rtl" lang="ar" {...text('welcomeAr')} />
              </Field>
              <Field label={labels.monogram} hint={labels.monogramHint} optionalLabel={labels.optional} error={fieldError('monogram')}>
                <Input maxLength={3} className="w-24 uppercase" dir="ltr" {...text('monogram')} />
              </Field>
            </div>

            <div aria-live="polite" className="space-y-2">
              {issues.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CircleCheck aria-hidden className="size-4" />
                  {labels.contrastOk}
                </p>
              ) : (
                issues.map((issue) => (
                  <p key={issue.pair} className="flex items-start gap-2 text-sm text-warning">
                    <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {labels.contrastIssueTemplate
                      .replace('{pair}', labels.pairs[issue.pair] ?? issue.pair)
                      .replace('{ratio}', String(issue.ratio))
                      .replace('{minimum}', String(issue.minimum))}
                  </p>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
              {canSave ? (
                <>
                  <SubmitButton name="intent" value="publish" disabled={anyInvalid} pendingLabel={labels.saving}>
                    {labels.publish}
                  </SubmitButton>
                  <SubmitButton name="intent" value="draft" variant="secondary" disabled={anyInvalid}>
                    {labels.saveDraft}
                  </SubmitButton>
                </>
              ) : null}
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw aria-hidden />
                {labels.reset}
              </Button>
            </div>
            {canSave ? <p className="text-xs text-muted-foreground">{labels.publishedNote}</p> : null}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{labels.preview}</p>
        <ChatPreview
          themeStyle={themeStyle}
          label={labels.sampleAnswerNote}
          universityName={universityName}
          assistantName={(isAr && draft.assistantNameAr) || draft.assistantName || fallbacks.assistantName}
          monogram={draft.monogram.toUpperCase() || monogram}
          logoUrl={logoUrl}
          question={labels.sampleQuestion}
          answer={(isAr && draft.welcomeAr) || draft.welcome || fallbacks.welcome}
          inputPlaceholder={labels.askPlaceholder}
        />
      </div>
    </div>
  )
}
