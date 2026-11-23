import 'server-only'
import { getServerEnv } from '@/lib/env/server'

/** AI configuration (Phase 5). The default model is Claude Opus 5.5 (docs/ai-architecture.md). */

export const DEFAULT_MODEL = 'claude-opus-5-5'

export function getAiConfig(): { configured: boolean; model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' } {
  const env = getServerEnv()
  return {
    configured: Boolean(env.ANTHROPIC_API_KEY),
    model: env.AI_MODEL ?? DEFAULT_MODEL,
    // Explicit: Claude Opus 5.5 defaults to medium; Q&A over short passages does not need more.
    effort: env.AI_EFFORT ?? 'medium',
  }
}
