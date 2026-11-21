'use client'

import { CircleCheck, RotateCcw, TriangleAlert } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { ChatPreview } from '@/components/marketing/chat-preview'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { assessThemeContrast, buildThemeVariables, parseHexColor, type ThemeColors } from '@/lib/branding/theme'

export type BrandingDraft = ThemeColors & { assistantName: string; welcome: string }

type Labels = {
  heading: string
  description: string
  primary: string
  secondary: string
  accent: string
  assistantName: string
  welcome: string
  preview: string
  contrastOk: string
  invalidHex: string
  picker: string
  reset: string
  saveDisabled: string
  sampleQuestion: string
  sampleAnswerNote: string
  askPlaceholder: string
  pairs: Record<string, string>
  /** Pre-rendered with {pair} {ratio} {minimum} placeholders (functions can't cross to the client). */
  contrastIssueTemplate: string
}

const COLOR_KEYS = ['primary', 'secondary', 'accent'] as const

/**
 * Live branding preview powered by the tenant theme engine. Saving/publishing is not
 * available until Phase 3, and the UI says so — nothing here pretends to persist.
 */
export function BrandingEditor({ initial, universityName, monogram, labels }: { initial: BrandingDraft; universityName: string; monogram: string; labels: Labels }) {
  const [draft, setDraft] = useState<BrandingDraft>(initial)
  const [raw, setRaw] = useState<Record<(typeof COLOR_KEYS)[number], string>>({
    primary: initial.primary,
    secondary: initial.secondary,
    accent: initial.accent,
  })

  const idPrefix = useId()
  const issues = useMemo(() => assessThemeContrast(draft), [draft])
  const themeStyle = useMemo(() => buildThemeVariables(draft), [draft])

  const setColor = (key: (typeof COLOR_KEYS)[number], value: string) => {
    setRaw((r) => ({ ...r, [key]: value }))
    const parsed = parseHexColor(value)
    if (parsed) setDraft((d) => ({ ...d, [key]: parsed }))
  }

  const reset = () => {
    setDraft(initial)
    setRaw({ primary: initial.primary, secondary: initial.secondary, accent: initial.accent })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.heading}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert variant="warning">{labels.saveDisabled}</Alert>

          <div className="grid gap-5 sm:grid-cols-3">
            {COLOR_KEYS.map((key) => {
              const invalid = parseHexColor(raw[key]) === null
              const inputId = `${idPrefix}-${key}`
              const errorId = `${inputId}-error`
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
                      type="text"
                      value={raw[key]}
                      onChange={(e) => setColor(key, e.target.value)}
                      maxLength={7}
                      spellCheck={false}
                      dir="ltr"
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                      className="font-mono"
                    />
                  </div>
                  {invalid ? (
                    <p id={errorId} className="text-xs font-medium text-danger">
                      {labels.invalidHex}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>

          <Field label={labels.assistantName}>
            <Input value={draft.assistantName} maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, assistantName: e.target.value }))} />
          </Field>
          <Field label={labels.welcome}>
            <Textarea value={draft.welcome} maxLength={280} rows={3} onChange={(e) => setDraft((d) => ({ ...d, welcome: e.target.value }))} />
          </Field>

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

          <Button variant="secondary" size="sm" onClick={reset}>
            <RotateCcw aria-hidden />
            {labels.reset}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{labels.preview}</p>
        <ChatPreview
          themeStyle={themeStyle}
          label={labels.sampleAnswerNote}
          universityName={universityName}
          assistantName={draft.assistantName || '—'}
          monogram={monogram}
          question={labels.sampleQuestion}
          answer={draft.welcome || '—'}
          inputPlaceholder={labels.askPlaceholder}
        />
      </div>
    </div>
  )
}
