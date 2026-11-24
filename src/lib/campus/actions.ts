'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionErrorKey, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import type { Json } from '@/lib/supabase/database.types'
import { askCampus, type CampusAiError, type CampusAnswer } from './ai'
import { locationNames, searchLocations } from './queries'
import { ACCESS_KEYS, askSchema, campusSettingsSchema, DAYS, locationSchema, toLocationPayload } from './schemas'

/** Campus Server Actions. The campus_* functions and RLS authorize every call again. */

const uuid = z.uuid()
const LOCATION_FIELDS = [
  'kind',
  'name',
  'nameAr',
  'code',
  'description',
  'descriptionAr',
  'parentId',
  'floor',
  'departmentId',
  'latitude',
  'longitude',
  'hoursKnown',
  ...DAYS.map((d) => `hours_${d}` as const),
  'hoursNote',
  'hoursNoteAr',
  ...ACCESS_KEYS.map((k) => `access_${k}` as const),
  'accessibilityNote',
  'accessibilityNoteAr',
  'phone',
  'email',
  'url',
  'aliases',
] as const

export async function saveLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const id = formData.get('locationId') ? uuid.safeParse(formData.get('locationId')) : null
  if (!slug.success || (id && !id.success)) return errorState('invalid')
  const parsed = locationSchema.safeParse(formValues(formData, LOCATION_FIELDS))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { data, error } = await ctx.supabase.rpc('campus_save_location', {
    p_tenant_slug: slug.data,
    p_location: id?.data ?? null,
    p_data: toLocationPayload(parsed.data) as unknown as Json,
  })
  if (error) return error.code === '22023' ? errorState('invalid', { parentId: 'campusBuilding' }) : dbFailure('campus_save_location', error)
  if (!id) redirect(localizedPath(readLocale(formData), `/app/${slug.data}/campus/manage/${data}`))
  refresh()
  return successState()
}

export async function setPublishedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = uuid.safeParse(formData.get('locationId'))
  if (!id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('campus_set_published', { p_location: id.data, p_published: formData.get('published') === 'true' })
  if (error) return dbFailure('campus_set_published', error)
  refresh()
  return successState()
}

export async function deleteLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const id = uuid.safeParse(formData.get('locationId'))
  if (!slug.success || !id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('campus_delete_location', { p_location: id.data })
  if (error) return dbFailure('campus_delete_location', error)
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/campus/manage`))
}

export async function updateCampusSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = campusSettingsSchema.safeParse(formValues(formData, ['aiEnabled', 'monthlyBudget', 'dailyLimit'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('campus_update_settings', {
    p_tenant_slug: slug.data,
    p_ai_enabled: parsed.data.aiEnabled,
    p_monthly_budget_usd: parsed.data.monthlyBudget,
    p_daily_limit: parsed.data.dailyLimit,
  })
  if (error) return dbFailure('campus_update_settings', error)
  refresh()
  return successState()
}

const ASK_ERRORS: Record<CampusAiError, ActionErrorKey> = {
  notConfigured: 'aiNotConfigured',
  disabled: 'campusOff',
  aiBudget: 'aiBudget',
  dailyLimit: 'dailyLimit',
  forbidden: 'forbidden',
  aiRefused: 'aiRefused',
  generic: 'generic',
}

/** A campus question, answered from the matching location records only. Not stored. */
export async function askCampusAction(_prev: ActionState<CampusAnswer>, formData: FormData): Promise<ActionState<CampusAnswer>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = askSchema.safeParse(formValues(formData, ['question'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('campus', ctx.user.id)) return errorState('rateLimited')
  const tenant = await ctx.supabase.from('tenants').select('id, timezone').eq('slug', slug.data).maybeSingle()
  if (!tenant.data) return errorState('notFound')
  const matches = (await searchLocations(slug.data, parsed.data.question, null, 8)).slice(0, 8)
  const names = await locationNames(
    tenant.data.id,
    matches.flatMap((l) => (l.parent_id ? [l.parent_id] : [])),
  )
  const buildings = new Map([...names].map(([id, n]) => [id, n.name_ar ? `${n.name} / ${n.name_ar}` : n.name]))
  const result = await askCampus({ supabase: ctx.supabase, slug: slug.data, question: parsed.data.question, matches, buildings, timeZone: tenant.data.timezone ?? 'UTC' })
  if (!result.ok) return errorState(ASK_ERRORS[result.error])
  return successState(result.result)
}
