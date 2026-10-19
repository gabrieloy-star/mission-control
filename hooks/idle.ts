// Idle compact: after the last message, one compaction a few minutes before the prompt cache
// expires, only when the conversation is big enough for an expired cache to cost real money.
// The timer itself lives in register.tsx: the engine is only passed to functions in that file.

import { MINUTE } from './suggestions'

export type IdleTimer = {
  generation: number
  timers: { cancel(): void }[]
  hasStatus: boolean
}

export type IdleOptions = {
  /** Compact this long before the cache expires; 0 turns idle compact off. */
  leadMs: number
  minTokens: number
  /** The conversation's tokens now: what a compaction shrinks. */
  conversation: () => Promise<number | null>
  /** When the prompt cache expires and how long it lives; null before the first request. */
  cache: () => Promise<{ end: number; ttl: number } | null>
  onCompacted: (before: number, after: number | undefined) => Promise<void>
}

/** The status line announces the compaction this long before it runs. */
export const WARN_BEFORE = 5 * MINUTE
/** A cache shorter than this (the 5-minute one) leaves no room to compact before it expires. */
export const SHORTEST_CACHE = 30 * MINUTE

export function newIdleTimer(): IdleTimer {
  return { generation: 0, timers: [], hasStatus: false }
}

/** What the compaction summary is asked to say and keep. */
export function idleInstructions(at: string, end: string) {
  return `Usage Coach compacted this idle session at ${at}, before the prompt cache expired at ${end}, so the next message does not pay to send the whole conversation again. ` +
    'Say so in one line at the top of the summary. Preserve open tasks, decisions with their reasons, pending follow-ups and their dates, files touched, and anything the user asked to keep.'
}
