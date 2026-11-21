'use client'

import { useState } from 'react'
import { ChatPreview } from '@/components/marketing/chat-preview'
import type { TenantBrandingPreview } from '@/lib/branding/demo-tenants'
import { buildThemeVariables } from '@/lib/branding/theme'
import type { Locale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

type Props = {
  locale: Locale
  tenants: TenantBrandingPreview[]
  labels: {
    switchLabel: string
    note: string
    question: string
    answer: string
    citationTitle: string
    citationMeta: string
    escalation: string
    fictional: string
  }
}

/** Live demonstration of the tenant theme engine: same component, different university. */
export function WhiteLabelDemo({ locale, tenants, labels }: Props) {
  const [slug, setSlug] = useState(tenants[0]?.slug)
  const tenant = tenants.find((t) => t.slug === slug) ?? tenants[0]
  if (!tenant) return null

  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
      <fieldset>
        <legend className="text-sm font-medium text-muted-foreground">{labels.switchLabel}</legend>
        <div className="mt-3 grid gap-2">
          {tenants.map((t) => (
            <label
              key={t.slug}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 transition-colors',
                t.slug === tenant.slug ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted',
              )}
              style={t.slug === tenant.slug ? buildThemeVariables(t.colors) : undefined}
            >
              <input
                type="radio"
                name="tenant"
                value={t.slug}
                checked={t.slug === tenant.slug}
                onChange={() => setSlug(t.slug)}
                className="sr-only"
              />
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: t.colors.primary }}>
                {t.monogram}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{t.name[locale]}</span>
                <span className="block text-xs text-muted-foreground">{labels.fictional}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{labels.note}</p>
      </fieldset>

      <div aria-live="polite">
        <ChatPreview
          themeStyle={buildThemeVariables(tenant.colors)}
          label={labels.note}
          universityName={tenant.name[locale]}
          assistantName={tenant.assistantName[locale]}
          monogram={tenant.monogram}
          question={labels.question}
          answer={labels.answer}
          citationTitle={labels.citationTitle}
          citationMeta={labels.citationMeta}
          escalation={labels.escalation}
          inputPlaceholder={tenant.welcome[locale]}
          className="mx-auto max-w-xl"
        />
      </div>
    </div>
  )
}
