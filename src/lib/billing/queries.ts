import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/** Read side of plans and subscriptions (Phase 15). The database decides who may read. */

const log = logger.child({ module: 'billing' })

function fail(op: string, error: { code?: string }): never {
  log.error('billing.query_failed', { op, code: error.code })
  throw new AppError('internal', `billing query failed: ${op}`)
}

const num = z.coerce.number()
const numOrNull = z.coerce.number().nullable()

export const planRow = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  name_ar: z.string().nullable(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  currency: z.string().nullable(),
  price_minor: numOrNull,
  billing_interval: z.enum(['month', 'year']),
  trial_days: num,
  grace_days: num,
  max_members: numOrNull,
  max_documents: numOrNull,
  ai_monthly_usd: numOrNull,
  sort_order: num,
  features: z.array(z.string()),
  subscribers: num,
})
export type Plan = z.infer<typeof planRow>

const limits = z.object({ members: numOrNull, documents: numOrNull, ai_monthly_usd: numOrNull }).nullable()
export type Limits = z.infer<typeof limits>
const usage = z.object({ members: num, documents: num, ai_month_usd: num })

const subscriptionRow = z.object({
  status: z.string(),
  plan_key: z.string(),
  plan_name: z.string(),
  grace_days: num,
  trial_ends_at: z.string().nullable(),
  period_end: z.string().nullable(),
  max_members_override: numOrNull,
  max_documents_override: numOrNull,
  ai_monthly_usd_override: numOrNull,
  billing_notes: z.string().nullable(),
})

const paymentRow = z.object({
  id: z.string().optional(),
  amount_minor: num,
  currency: z.string(),
  method: z.string(),
  reference: z.string().nullable(),
  paid_on: z.string(),
  extends_months: num,
  note: z.string().nullable().optional(),
})
export type Payment = z.infer<typeof paymentRow>

const eventRow = z.object({
  id: num,
  kind: z.string(),
  from_status: z.string().nullable(),
  to_status: z.string().nullable(),
  plan_key: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
})
export type SubscriptionEvent = z.infer<typeof eventRow>

const platformSubscription = z.object({
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string() }),
  subscription: subscriptionRow.nullable(),
  limits,
  usage,
  payments: z.array(paymentRow),
  events: z.array(eventRow),
})
export type PlatformSubscription = z.infer<typeof platformSubscription>

const reportRow = z.object({
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  is_demo: z.boolean(),
  plan: z.string().nullable(),
  subscription_status: z.string().nullable(),
  period_end: z.string().nullable(),
  trial_ends_at: z.string().nullable(),
  limits,
  members: num,
  documents: num,
  storage_bytes: num,
  ai_calls: num,
  ai_cost_usd: num,
  voice_cost_usd: num,
  conversations: num,
  tickets: num,
  paid: z.record(z.string(), num),
})
export type UsageRow = z.infer<typeof reportRow>

const tenantSubscription = z.object({
  tenant_status: z.string(),
  subscription: z
    .object({
      plan_name: z.string(),
      plan_name_ar: z.string().nullable(),
      status: z.string(),
      trial_ends_at: z.string().nullable(),
      period_end: z.string().nullable(),
      grace_days: num,
      currency: z.string().nullable(),
      price_minor: numOrNull,
      billing_interval: z.string(),
    })
    .nullable(),
  limits,
  usage,
  payments: z.array(paymentRow).nullable(),
})
export type TenantSubscription = z.infer<typeof tenantSubscription>

export async function listPlans(): Promise<Plan[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('platform_plans')
  if (error) fail('platform_plans', error)
  return z.array(planRow).parse(data)
}

export async function getPlatformSubscription(slug: string): Promise<PlatformSubscription | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('platform_subscription', { p_tenant_slug: slug })
  if (error) fail('platform_subscription', error)
  return data ? platformSubscription.parse(data) : null
}

export async function getUsageReport(month: string): Promise<{ month: string; tenants: UsageRow[] }> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('platform_usage_report', { p_month: `${month}-01` })
  if (error) fail('platform_usage_report', error)
  return z.object({ month: z.string(), tenants: z.array(reportRow) }).parse(data)
}

/** The university's own view; null when the caller may not read it (or on failure, logged). */
export async function getTenantSubscription(slug: string): Promise<TenantSubscription | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('tenant_subscription', { p_tenant_slug: slug })
  if (error) {
    if (error.code !== '42501') log.error('billing.query_failed', { op: 'tenant_subscription', code: error.code })
    return null
  }
  const parsed = tenantSubscription.safeParse(data)
  if (!parsed.success) log.error('billing.parse_failed', { op: 'tenant_subscription' })
  return parsed.success ? parsed.data : null
}

export async function listFeatureCatalog(): Promise<{ key: string; description: string }[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('features').select('key, description').order('planned_phase').order('key')
  if (error) fail('features', error)
  return data ?? []
}
