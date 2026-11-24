'use client'

import { FileText, GraduationCap, LifeBuoy, Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { openKnowledgeSource, setAssistantFeedback } from '@/lib/assistant/actions'
import type { ChatCitation, ChatMessage } from '@/lib/assistant/queries'
import { cn } from '@/lib/utils'
import { DictateButton, ReadAloudButton, type VoiceConfig } from '@/components/voice/voice-controls'

/**
 * Student chat. Questions go to the streaming endpoint (/api/assistant/[tenant]); the answer
 * text streams in, then the final event replaces it with the stored answer, its [n] markers
 * and the numbered sources. Sources open the cited document (signed link, the student's own
 * permissions). Only plain strings are passed in from the server.
 */

export type ChatLabels = {
  placeholder: string
  send: string
  searching: string
  writing: string
  you: string
  sources: string
  /** Pre-rendered page labels with {from} / {to}. */
  pageSingle: string
  pageRange: string
  openSource: string
  sourceUnavailable: string
  helpful: string
  notHelpful: string
  feedbackThanks: string
  feedbackComment: string
  sendFeedback: string
  statuses: Record<string, string>
  errors: Record<string, string>
}

type UiMessage = ChatMessage & { pending?: boolean }

/** How sources link out: documents through a signed link (members) or not at all (visitors); programs to their page. */
type SourceOptions = { documentLinks: boolean; programHref?: (code: string) => string }

type StreamEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'status'; stage: 'searching' | 'writing' }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string | null; status: ChatMessage['status']; text: string; citations: ChatCitation[] }
  | { type: 'error'; error: string }

export function AssistantChat({
  tenant,
  locale,
  basePath,
  assistantName,
  welcome,
  conversationId: initialConversationId,
  initialMessages,
  unavailable,
  labels,
  endpoint,
  documentLinks = true,
  programHref,
  onConversation,
  handoff,
  extraBody,
  voice,
}: {
  tenant: string
  locale: 'en' | 'ar'
  /** Page URL to keep in sync with the conversation (student chat). Omit for embedded chats. */
  basePath?: string
  assistantName: string
  welcome: string
  conversationId: string | null
  initialMessages: ChatMessage[]
  /** Why questions cannot be asked right now (null: they can). */
  unavailable: string | null
  labels: ChatLabels
  /** Default: the student assistant endpoint. */
  endpoint?: string
  documentLinks?: boolean
  programHref?: (code: string) => string
  onConversation?: (id: string) => void
  /** "Ask a person" (Phase 7): link to a new request; `?c=<conversation>` is added once there is one. */
  handoff?: { href: string; label: string; hint: string }
  /** Extra JSON fields sent with each question (staff assistant: the department filter). */
  extraBody?: Record<string, string | null>
  /** Speech input and read-aloud (Phase 13), when the university has voice switched on. */
  voice?: VoiceConfig
}) {
  const router = useRouter()
  const sourceOptions: SourceOptions = { documentLinks, programHref }
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages)
  const [conversationId, setConversationId] = useState(initialConversationId)
  const [stage, setStage] = useState<'searching' | 'writing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const busy = stage !== null

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, stage])

  async function ask(question: string) {
    setError(null)
    setStage('searching')
    const temp = `pending-${Date.now()}`
    setMessages((m) => [
      ...m,
      { id: `${temp}-q`, role: 'user', content: question, status: 'question', citations: [], rating: null, createdAt: new Date().toISOString() },
    ])
    const fail = (key: string) => {
      setError(labels.errors[key] ?? labels.errors.generic!)
      setMessages((m) => m.filter((x) => x.id !== `${temp}-a`))
    }

    let response: Response
    try {
      response = await fetch(endpoint ?? `/api/assistant/${encodeURIComponent(tenant)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...extraBody, question, conversationId, locale }),
      })
    } catch {
      setStage(null)
      return fail('generic')
    }
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setStage(null)
      return fail(body.error ?? 'generic')
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let finished = false
    const handle = (event: StreamEvent) => {
      switch (event.type) {
        case 'meta':
          if (event.conversationId !== conversationId) {
            setConversationId(event.conversationId)
            onConversation?.(event.conversationId)
            if (basePath) window.history.replaceState(null, '', `${basePath}?c=${event.conversationId}`)
          }
          break
        case 'status':
          setStage(event.stage)
          break
        case 'delta':
          setMessages((m) => {
            const last = m[m.length - 1]
            if (last?.id === `${temp}-a`) return [...m.slice(0, -1), { ...last, content: last.content + event.text }]
            return [...m, { id: `${temp}-a`, role: 'assistant', content: event.text, status: 'answered', citations: [], rating: null, createdAt: new Date().toISOString(), pending: true }]
          })
          break
        case 'done':
          finished = true
          setMessages((m) => [
            ...m.filter((x) => x.id !== `${temp}-a`),
            { id: event.messageId ?? `${temp}-a`, role: 'assistant', content: event.text, status: event.status, citations: event.citations, rating: null, createdAt: new Date().toISOString() },
          ])
          break
        case 'error':
          finished = true
          fail(event.error)
          break
      }
    }
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (line) handle(JSON.parse(line) as StreamEvent)
        }
      }
      if (!finished) fail('generic')
    } catch {
      fail('generic')
    } finally {
      setStage(null)
      if (basePath) router.refresh() // the conversation list on the side
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const question = draft.trim()
    if (busy || unavailable || question.length < 2) return
    setDraft('')
    void ask(question)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
  }

  return (
    <div className="flex min-h-[28rem] flex-col rounded-xl border border-border bg-canvas">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? (
          <div className="max-w-[92%] rounded-2xl rounded-es-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{assistantName}</p>
            <p dir="auto">{welcome}</p>
          </div>
        ) : null}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-line text-primary-foreground" dir="auto">
                <span className="sr-only">{labels.you}: </span>
                {m.content}
              </p>
            </div>
          ) : (
            <AssistantMessage key={m.id} message={m} assistantName={assistantName} labels={labels} sources={sourceOptions} voice={voice} />
          ),
        )}
        {stage && !messages.some((m) => m.pending) ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {stage === 'searching' ? labels.searching : labels.writing}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <div className="px-4 pb-2">
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        </div>
      ) : null}

      {handoff && !busy && messages.some((m) => m.role === 'assistant' && !m.pending) ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2 text-xs">
          <LifeBuoy aria-hidden className="size-3.5 text-muted-foreground" />
          <a href={conversationId ? `${handoff.href}?c=${encodeURIComponent(conversationId)}` : handoff.href} className="font-medium text-primary hover:underline">
            {handoff.label}
          </a>
          <span className="text-muted-foreground">{handoff.hint}</span>
        </div>
      ) : null}

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-card p-3">
        <label htmlFor="assistant-question" className="sr-only">
          {labels.placeholder}
        </label>
        <Textarea
          id="assistant-question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={unavailable ?? labels.placeholder}
          disabled={!!unavailable}
          maxLength={2000}
          rows={2}
          // Empty: follow the page direction (placeholder); typed text: follow the text.
          dir={draft.trim() ? 'auto' : undefined}
          className="min-h-11 flex-1 resize-none"
        />
        {voice ? <DictateButton config={voice} disabled={busy || !!unavailable} onText={(text) => setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text).slice(0, 2000))} /> : null}
        <Button type="submit" size="icon" disabled={busy || !!unavailable || draft.trim().length < 2} aria-label={labels.send}>
          {busy ? <Spinner className="size-4" /> : <Send aria-hidden className="rtl:-scale-x-100" />}
        </Button>
      </form>
    </div>
  )
}

function AssistantMessage({ message, assistantName, labels, sources, voice }: { message: UiMessage; assistantName: string; labels: ChatLabels; sources: SourceOptions; voice?: VoiceConfig }) {
  const statusLabel = message.status !== 'answered' ? labels.statuses[message.status] : undefined
  return (
    <div className="max-w-[92%] space-y-3 rounded-2xl rounded-es-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{assistantName}</p>
        {statusLabel && !message.pending ? <Badge variant={message.status === 'error' ? 'danger' : 'warning'}>{statusLabel}</Badge> : null}
        {voice && !message.pending && message.status !== 'error' ? <ReadAloudButton config={voice} text={message.content} className="ms-auto h-7" /> : null}
      </div>
      <p className="whitespace-pre-line" dir="auto">
        {renderWithMarkers(message.content)}
      </p>
      {message.citations.length > 0 ? <SourceList citations={message.citations} labels={labels} options={sources} /> : null}
      {!message.pending && message.status !== 'error' && !message.id.startsWith('pending-') ? <Feedback message={message} labels={labels} /> : null}
    </div>
  )
}

/** Show the [n] markers as small reference labels. */
function renderWithMarkers(text: string) {
  return text.split(/(\[\d{1,2}\])/g).map((part, i) =>
    /^\[\d{1,2}\]$/.test(part) ? (
      <sup key={i} className="ms-0.5 rounded bg-primary-subtle px-1 text-[0.7rem] font-semibold text-primary-subtle-foreground">
        {part.slice(1, -1)}
      </sup>
    ) : (
      part
    ),
  )
}

function SourceList({ citations, labels, options }: { citations: ChatCitation[]; labels: ChatLabels; options: SourceOptions }) {
  const [failed, setFailed] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()

  const page = (c: ChatCitation) =>
    c.page_from == null
      ? null
      : c.page_to && c.page_to !== c.page_from
        ? labels.pageRange.replace('{from}', String(c.page_from)).replace('{to}', String(c.page_to))
        : labels.pageSingle.replace('{from}', String(c.page_from))

  function open(c: ChatCitation) {
    setFailed(null)
    // Open the tab synchronously (popup blockers), then point it at the signed link.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    startTransition(async () => {
      const result = await openKnowledgeSource({ documentId: c.document_id })
      if (result.status !== 'success' || !result.data) {
        tab?.close()
        setFailed(c.n)
        return
      }
      const url = result.data.isPdf && c.page_from ? `${result.data.url}#page=${c.page_from}` : result.data.url
      if (tab) tab.location.href = url
      else window.location.href = url
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">{labels.sources}</p>
      <ol className="space-y-2">
        {citations.map((c) => {
          const body = (
            <>
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-primary-subtle text-[0.7rem] font-semibold text-primary-subtle-foreground">{c.n}</span>
              {c.program_code ? <GraduationCap aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" /> : <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold" dir="auto">
                  {c.title}
                  {page(c) ? <span className="font-normal text-muted-foreground"> · {page(c)}</span> : null}
                </span>
                {c.cited_text ? (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground" dir="auto">
                    “{c.cited_text}”
                  </span>
                ) : null}
              </span>
            </>
          )
          const box = 'flex w-full items-start gap-2.5 rounded-lg border border-border bg-canvas p-2.5 text-start'
          return (
            <li key={c.n}>
              {c.program_code && options.programHref ? (
                <a href={options.programHref(c.program_code)} className={`${box} hover:bg-muted/60`}>
                  {body}
                </a>
              ) : !c.program_code && options.documentLinks ? (
                <button type="button" onClick={() => open(c)} disabled={pending} title={labels.openSource} className={`${box} hover:bg-muted/60 disabled:opacity-70`}>
                  {body}
                </button>
              ) : (
                <div className={box}>{body}</div>
              )}
              {failed === c.n ? <p className="mt-1 text-xs text-danger">{labels.sourceUnavailable}</p> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Feedback({ message, labels }: { message: UiMessage; labels: ChatLabels }) {
  const [rating, setRating] = useState<1 | -1 | null>(message.rating)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, startTransition] = useTransition()

  const rate = (value: 1 | -1, text?: string) =>
    startTransition(async () => {
      const result = await setAssistantFeedback({ messageId: message.id, rating: value, comment: text })
      if (result.status === 'success') {
        setRating(value)
        setSent(value === 1 || text !== undefined)
      }
    })

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" aria-pressed={rating === 1} disabled={pending} onClick={() => rate(1)} className={cn(rating === 1 && 'text-success')}>
          <ThumbsUp aria-hidden />
          <span className="sr-only sm:not-sr-only">{labels.helpful}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-pressed={rating === -1} disabled={pending} onClick={() => rate(-1)} className={cn(rating === -1 && 'text-danger')}>
          <ThumbsDown aria-hidden />
          <span className="sr-only sm:not-sr-only">{labels.notHelpful}</span>
        </Button>
        {sent ? (
          <span className="ms-2 text-xs text-muted-foreground" role="status">
            {labels.feedbackThanks}
          </span>
        ) : null}
      </div>
      {rating === -1 && !sent ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            rate(-1, comment.trim())
          }}
        >
          <label className="sr-only" htmlFor={`feedback-${message.id}`}>
            {labels.feedbackComment}
          </label>
          <Textarea id={`feedback-${message.id}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={labels.feedbackComment} maxLength={1000} rows={2} dir="auto" className="flex-1" />
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {labels.sendFeedback}
          </Button>
        </form>
      ) : null}
    </div>
  )
}

export function HandoffNote({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <LifeBuoy aria-hidden className="size-3.5" />
      {text}
    </p>
  )
}
