'use client'

import { createClient } from '@supabase/supabase-js'
import { Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import { FieldErrorProvider, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { beginKnowledgeUpload, finishKnowledgeUpload } from '@/lib/knowledge/actions'
import { KNOWLEDGE_ACCEPT, KNOWLEDGE_MAX_BYTES, knowledgeTypeFor } from '@/lib/knowledge/file-types'
import type { ActionErrorKey } from '@/lib/management/action-state'
import { KnowledgeMetaFields, metaFromForm, type MetaLabels } from './meta-fields'

type Phase = 'idle' | 'uploading' | 'verifying' | 'done'

export type UploadLabels = {
  file: string
  submit: string
  uploading: string
  verifying: string
  queued: string
}

/**
 * Upload flow: 1) the server registers the version and returns a one-time signed upload
 * token, 2) the browser sends the file directly to the private bucket, 3) the server verifies
 * the stored bytes and starts processing. With `documentId` it uploads a new version only.
 */
export function KnowledgeUploadForm({
  tenant,
  documentId,
  supabaseUrl,
  supabaseKey,
  departments = [],
  roles = [],
  labels,
  metaLabels,
  messages,
}: {
  tenant: string
  documentId?: string
  supabaseUrl: string
  supabaseKey: string
  departments?: { id: string; label: string }[]
  roles?: { id: string; label: string }[]
  labels: UploadLabels
  metaLabels?: MetaLabels
  messages: FormMessages
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<ActionErrorKey | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const busy = phase === 'uploading' || phase === 'verifying'

  const fail = (key: ActionErrorKey, fields: Record<string, string> = {}) => {
    setError(Object.keys(fields).length ? (key === 'invalid' ? 'invalid' : key) : key)
    setFieldErrors(fields)
    setPhase('idle')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    const file = fd.get('file')
    setError(null)
    setFieldErrors({})
    if (!(file instanceof File) || file.size === 0) return fail('invalid', { file: 'fileRequired' })
    const type = knowledgeTypeFor(file.name, file.type)
    if (!type) return fail('invalid', { file: 'knowledgeFileType' })
    if (file.size > KNOWLEDGE_MAX_BYTES) return fail('invalid', { file: 'knowledgeFileTooLarge' })

    setPhase('uploading')
    const begun = await beginKnowledgeUpload({ tenant, documentId, fileName: file.name, size: file.size, type, meta: documentId ? undefined : metaFromForm(fd) })
    if (begun.status !== 'success' || !begun.data) {
      return fail(begun.status === 'error' ? begun.error : 'generic', begun.status === 'error' ? ((begun.fieldErrors ?? {}) as Record<string, string>) : {})
    }

    const storage = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage
    const uploaded = await storage.from('tenant-documents').uploadToSignedUrl(begun.data.path, begun.data.token, file, { contentType: type })
    if (uploaded.error) return fail('generic')

    setPhase('verifying')
    const finished = await finishKnowledgeUpload({ versionId: begun.data.versionId })
    if (finished.status !== 'success') {
      return fail(finished.status === 'error' ? finished.error : 'generic', finished.status === 'error' ? ((finished.fieldErrors ?? {}) as Record<string, string>) : {})
    }
    formRef.current?.reset()
    setPhase('done')
    router.refresh()
  }

  const fieldError = (name: string) => {
    const key = fieldErrors[name]
    return key ? (messages.validation[key] ?? messages.validation.invalidValue) : undefined
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="danger" role="alert">
          {messages.errors[error]}
        </Alert>
      ) : null}
      {phase === 'done' ? (
        <Alert variant="success" role="status">
          {labels.queued}
        </Alert>
      ) : null}
      <FieldErrorProvider fieldError={fieldError}>
        <fieldset disabled={busy} className="space-y-4">
          <FormField name="file" label={labels.file}>
            <input
              type="file"
              name="file"
              accept={KNOWLEDGE_ACCEPT}
              required
              className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
            />
          </FormField>
          {metaLabels && !documentId ? <KnowledgeMetaFields departments={departments} roles={roles} labels={metaLabels} /> : null}
        </fieldset>
      </FieldErrorProvider>
      <Button type="submit" disabled={busy} aria-disabled={busy}>
        {busy ? <Spinner /> : <Upload aria-hidden />}
        {phase === 'uploading' ? labels.uploading : phase === 'verifying' ? labels.verifying : labels.submit}
      </Button>
    </form>
  )
}
