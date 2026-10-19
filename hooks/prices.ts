// Anthropic first-party list prices, dollars per million tokens, as of 2026-10-06.
// Cache writes are priced from input: 1.25x for the 5-minute cache, 2x for the 1-hour cache
// Claude Code uses. On a subscription these are equivalents, not a bill.

import type { Tokens } from '../types'

export type Price = { input: number; output: number; read: number }

const TABLE: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-fable-5': { input: 10, output: 50, read: 1 },
  'claude-mythos-5': { input: 10, output: 50, read: 1 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-opus-5': { input: 5, output: 25, read: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, read: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, read: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, read: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, read: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, read: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, read: 0.1 },
}

/** The session's default when a model is unknown: the current Opus. */
const FALLBACK = TABLE['claude-opus-5-5']!

/** `claude-opus-5-5[1m]` and dated ids resolve to their family's row. */
export function priceOf(model: string | undefined): Price {
  if (!model) return FALLBACK
  const id = model.replace(/\[.*\]$/, '').replace(/^.*\//, '').replace(/^anthropic\./, '').replace(/-\d{8}$/, '')
  return TABLE[id] ?? FALLBACK
}

const M = 1e6

/** Writing `tokens` into the 1-hour cache from scratch: what a cold return pays. */
export function rewriteUsd(tokens: number, model: string): number {
  return (tokens * 2 * priceOf(model).input) / M
}

/** Reading `tokens` from a warm cache: what each request pays to carry them. */
export function readUsd(tokens: number, model: string): number {
  return (tokens * priceOf(model).read) / M
}

/** A summary this size replaces the conversation after a compaction (observed 10k to 20k). */
export const SUMMARY_TOKENS = 15_000
const SUMMARY_OUTPUT = 5_000

/** One compaction: read the conversation from the cache, write a summary, cache the summary. */
export function compactUsd(tokens: number, model: string): number {
  const p = priceOf(model)
  return (tokens * p.read + SUMMARY_OUTPUT * p.output + SUMMARY_TOKENS * 2 * p.input) / M
}

export function tokensUsd(t: Tokens, model: string): number {
  const p = priceOf(model)
  return (t.input * p.input + t.output * p.output + t.read * p.read + t.write5m * 1.25 * p.input + t.write1h * 2 * p.input) / M
}

export function sumTokens(t: Tokens): number {
  return t.input + t.output + t.read + t.write5m + t.write1h
}
