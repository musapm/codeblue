'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { assignSchema, limitsSchema, paymentSchema, planSchema } from './schemas'

/**
 * Plans and subscriptions (Phase 15). The database allows these only to platform owners,
 * admins and billing staff, and checks every value again; this file validates and reports.
 */

const slugSchema = z.string().regex(/^[a-z0-9-]{1,48}$/)

export async function savePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const planId = formData.get('planId') ? z.uuid().safeParse(formData.get('planId')) : null
  if (planId && !planId.success) return errorState('invalid')
  const parsed = planSchema.safeParse({
    ...formValues(formData, ['key', 'name', 'nameAr', 'description', 'currency', 'price', 'interval', 'trialDays', 'graceDays', 'maxMembers', 'maxDocuments', 'aiMonthlyUsd'] as const),
    isActive: formData.get('isActive') === 'on',
    features: formData.getAll('features').map(String),
  })
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const p = parsed.data
  const { data, error } = await ctx.supabase.rpc('platform_plan_save', {
    p_plan: planId?.data ?? null,
    p_key: p.key,
    p_name: p.name,
    p_name_ar: p.nameAr,
    p_description: p.description,
    p_is_active: p.isActive,
    p_currency: p.currency,
    p_price_minor: p.priceMinor,
    p_interval: p.interval,
    p_trial_days: p.trialDays,
    p_grace_days: p.graceDays,
    p_max_members: p.maxMembers,
    p_max_documents: p.maxDocuments,
    p_ai_monthly_usd: p.aiMonthlyUsd,
    p_features: p.features,
  })
  if (error) return error.code === '23505' ? errorState('conflict', { key: 'planKey' }) : dbFailure('platform_plan_save', error)
  if (!planId) redirect(localizedPath(readLocale(formData), `/platform/plans/${data}`))
  refresh()
  return successState()
}

export async function deletePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = z.uuid().safeParse(formData.get('planId'))
  if (!id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('platform_plan_delete', { p_plan: id.data })
  if (error) return error.code === '23503' ? errorState('inUse') : dbFailure('platform_plan_delete', error)
  redirect(localizedPath(readLocale(formData), '/platform/plans'))
}

export async function assignPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugSchema.safeParse(formData.get('slug'))
  const parsed = assignSchema.safeParse(formValues(formData, ['planKey', 'mode', 'months', 'note'] as const))
  if (!slug.success) return errorState('invalid')
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('platform_assign_plan', {
    p_tenant_slug: slug.data,
    p_plan_key: parsed.data.planKey,
    p_trial: parsed.data.mode === 'trial',
    p_months: parsed.data.months,
    p_note: parsed.data.note,
  })
  if (error) return dbFailure('platform_assign_plan', error)
  refresh()
  return successState()
}

export async function setSubscriptionStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugSchema.safeParse(formData.get('slug'))
  const status = z.enum(['active', 'suspended', 'cancelled']).safeParse(formData.get('status'))
  if (!slug.success || !status.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('platform_set_subscription_status', { p_tenant_slug: slug.data, p_status: status.data })
  if (error) return dbFailure('platform_set_subscription_status', error)
  refresh()
  return successState()
}

export async function setLimitsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugSchema.safeParse(formData.get('slug'))
  const parsed = limitsSchema.safeParse(formValues(formData, ['maxMembers', 'maxDocuments', 'aiMonthlyUsd', 'billingNotes'] as const))
  if (!slug.success) return errorState('invalid')
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('platform_set_limits', {
    p_tenant_slug: slug.data,
    p_max_members: parsed.data.maxMembers,
    p_max_documents: parsed.data.maxDocuments,
    p_ai_monthly_usd: parsed.data.aiMonthlyUsd,
    p_billing_notes: parsed.data.billingNotes,
  })
  if (error) return dbFailure('platform_set_limits', error)
  refresh()
  return successState()
}

export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugSchema.safeParse(formData.get('slug'))
  const parsed = paymentSchema.safeParse(formValues(formData, ['amount', 'currency', 'method', 'reference', 'paidOn', 'extendsMonths', 'note'] as const))
  if (!slug.success) return errorState('invalid')
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const p = parsed.data
  const { error } = await ctx.supabase.rpc('platform_record_payment', {
    p_tenant_slug: slug.data,
    p_amount_minor: p.amountMinor,
    p_currency: p.currency,
    p_method: p.method,
    p_reference: p.reference,
    p_paid_on: p.paidOn,
    p_extends_months: p.extendsMonths,
    p_note: p.note,
  })
  if (error) return dbFailure('platform_record_payment', error)
  refresh()
  return successState()
}

export async function runSweepAction(): Promise<ActionState<{ changed: number }>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const { data, error } = await ctx.supabase.rpc('subscription_sweep')
  if (error) return dbFailure('subscription_sweep', error)
  refresh()
  return successState({ changed: z.object({ changed: z.number() }).parse(data).changed })
}
