import { FileText, LifeBuoy, Send } from 'lucide-react'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type ChatPreviewProps = {
  label: string
  universityName: string
  assistantName: string
  monogram: string
  /** Public URL of the tenant logo (Supabase Storage); falls back to the monogram. */
  logoUrl?: string
  question: string
  answer: string
  citationTitle?: string
  citationMeta?: string
  escalation?: string
  inputPlaceholder?: string
  /** CSS variables from buildThemeVariables(); scopes the tenant theme to this card. */
  themeStyle?: CSSProperties
  className?: string
}

/**
 * Static, illustrative mock of the student assistant. It is clearly labelled as a preview
 * and contains no live AI — the real chat arrives in Phase 5.
 */
export function ChatPreview(props: ChatPreviewProps) {
  return (
    <figure
      style={props.themeStyle}
      className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_40px_-12px_rgb(15_42_74_/_0.25)]', props.className)}
    >
      <div className="flex items-center gap-3 bg-secondary px-4 py-3 text-secondary-foreground">
        {props.logoUrl ? (
          // Tenant logos come from Supabase Storage (allowed by the CSP img-src); next/image
          // would need a remote pattern per project, and these files are already ≤ 1 MB.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.logoUrl} alt="" className="size-9 rounded-lg bg-white object-contain p-0.5" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{props.monogram}</span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{props.assistantName}</p>
          <p className="truncate text-xs opacity-75">{props.universityName}</p>
        </div>
      </div>

      <div className="space-y-4 bg-canvas p-4 sm:p-5">
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">{props.question}</p>
        </div>
        <div className="max-w-[92%] space-y-3 rounded-2xl rounded-es-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
          <p>{props.answer}</p>
          {props.citationTitle ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-canvas p-2.5">
              <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{props.citationTitle}</p>
                {props.citationMeta ? <p className="text-xs text-muted-foreground">{props.citationMeta}</p> : null}
              </div>
            </div>
          ) : null}
          {props.escalation ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LifeBuoy aria-hidden className="size-3.5" />
              {props.escalation}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-3">
        <div className="h-9 flex-1 rounded-full border border-border bg-canvas px-4 text-sm leading-9 text-muted-foreground" aria-hidden>
          {props.inputPlaceholder ?? '…'}
        </div>
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Send className="size-4 rtl:-scale-x-100" />
        </span>
      </div>

      <figcaption className="border-t border-border bg-card px-4 py-2 text-center text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
        {props.label}
      </figcaption>
    </figure>
  )
}
