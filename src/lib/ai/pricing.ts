/**
 * Estimated cost of a model call from provider-reported token usage (pure).
 *
 * USD per million tokens, Claude API first-party list prices as of 2026-11-03. Cache writes
 * (5-minute TTL) cost 1.25x input; cache reads are listed separately. This is an estimate for
 * budgets and reports, not an invoice. Unknown models are priced at the highest known rate so
 * budgets fail safe. Keep in sync with docs/ai-architecture.md when prices change.
 */

type Price = { input: number; output: number; cacheRead: number }

export const MODEL_PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
}

const FALLBACK_PRICE: Price = { input: 10, output: 50, cacheRead: 1 }

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

/** Price for a model id; dated ids (e.g. `claude-opus-5-5-20261101`) use the longest known prefix. */
export function priceFor(model: string): Price {
  const exact = MODEL_PRICES[model]
  if (exact) return exact
  const prefix = Object.keys(MODEL_PRICES)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? MODEL_PRICES[prefix]! : FALLBACK_PRICE
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const p = priceFor(model)
  const cost =
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.input * 1.25) / 1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}
