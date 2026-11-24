'use client'

import { useId, useState } from 'react'
import { AssistantChat, type ChatLabels } from '@/components/assistant/chat'
import type { VoiceConfig } from '@/components/voice/voice-controls'
import { Select } from '@/components/ui/input'
import type { ChatMessage } from '@/lib/assistant/queries'

/**
 * Staff chat: the shared assistant chat on the staff endpoint, with a department filter for
 * retrieval. The filter only narrows the search; the database still returns only documents
 * the staff member may read.
 */
export function StaffChat({
  tenant,
  locale,
  basePath,
  conversationId,
  initialMessages,
  unavailable,
  labels,
  assistantName,
  welcome,
  departments,
  departmentLabels,
  voice,
}: {
  tenant: string
  locale: 'en' | 'ar'
  basePath: string
  conversationId: string | null
  initialMessages: ChatMessage[]
  unavailable: string | null
  labels: ChatLabels
  assistantName: string
  welcome: string
  departments: { value: string; label: string }[]
  departmentLabels: { label: string; all: string }
  voice?: VoiceConfig
}) {
  const id = useId()
  const [departmentId, setDepartmentId] = useState('')
  return (
    <div className="space-y-3">
      {departments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium">
            {departmentLabels.label}
          </label>
          <Select id={id} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-9 w-auto min-w-48" disabled={!!unavailable}>
            <option value="">{departmentLabels.all}</option>
            {departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <AssistantChat
        tenant={tenant}
        locale={locale}
        basePath={basePath}
        assistantName={assistantName}
        welcome={welcome}
        conversationId={conversationId}
        initialMessages={initialMessages}
        unavailable={unavailable}
        labels={labels}
        endpoint={`/api/staff-assistant/${encodeURIComponent(tenant)}`}
        extraBody={{ departmentId: departmentId || null }}
        voice={voice}
      />
    </div>
  )
}
