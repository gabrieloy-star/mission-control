// Idle compact: after the last message, one compaction a few minutes before the prompt cache
// expires, only when the conversation is big enough for an expired cache to cost real money.

import type { EngineInterface } from 'claude-code'
import { MINUTE, clockOf, tok } from './moves'

export type Fuse = {
  generation: number
  timers: { cancel(): void }[]
  hasStatus: boolean
}

export type FuseOptions = {
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
const WARN_BEFORE = 5 * MINUTE
/** A cache shorter than this (the 5-minute one) leaves no room to compact before it expires. */
const SHORTEST_CACHE = 30 * MINUTE

export function newFuse(): Fuse {
  return { generation: 0, timers: [], hasStatus: false }
}

export function defuse($: EngineInterface, f: Fuse) {
  f.generation++
  for (const t of f.timers) t.cancel()
  f.timers = []
  if (f.hasStatus) $.ui.status(undefined)
  f.hasStatus = false
}

function instructions(at: string, end: string) {
  return `Usage Coach compacted this idle session at ${at}, before the prompt cache expired at ${end}, so the next message does not pay to send the whole conversation again. ` +
    'Say so in one line at the top of the summary. Preserve open tasks, decisions with their reasons, pending follow-ups and their dates, files touched, and anything the user asked to keep.'
}

/** Runs one compaction now; resolves false when there was nothing worth compacting or a turn was running. */
export async function compactNow($: EngineInterface, o: FuseOptions, why: string): Promise<boolean> {
  const before = await o.conversation()
  if (before === null || before < Math.min(o.minTokens, 5_000)) return false
  try {
    const result = await $.session.compact({ instructions: why })
    if (!result.messages) return false
    await o.onCompacted(result.tokensBefore ?? before, result.tokensAfter)
    return true
  } catch {
    return false
  }
}

/** Sets the timer at the end of a main-loop turn. */
export async function light($: EngineInterface, f: Fuse, o: FuseOptions) {
  defuse($, f)
  if (o.leadMs <= 0) return
  const cache = await o.cache()
  if (!cache || cache.ttl < SHORTEST_CACHE) return
  const lit = f.generation
  const now = await $.clock.now()
  const fireAt = cache.end - o.leadMs
  if (fireAt <= now) return

  f.timers.push($.clock.after(Math.max(0, fireAt - WARN_BEFORE - now), async () => {
    if (lit !== f.generation) return
    const conv = await o.conversation().catch(() => null)
    if (conv === null || conv < o.minTokens) return
    $.ui.status(`◆ Usage Coach compacts at ${clockOf(fireAt)} unless you send a message · the cache expires at ${clockOf(cache.end)} · ${tok(conv)} tokens of conversation`)
    f.hasStatus = true
  }))

  f.timers.push($.clock.after(fireAt - now, async () => {
    if (lit !== f.generation) return
    const at = await $.clock.now()
    // A timer that fires late (the Mac slept) finds the cache expired: compacting then saves nothing.
    if (at >= cache.end) {
      $.ui.log(`◆ Usage Coach did not compact: the cache expired at ${clockOf(cache.end)} while the Mac was asleep`)
      defuse($, f)
      return
    }
    const conv = await o.conversation().catch(() => null)
    if (conv === null || conv < o.minTokens) {
      defuse($, f)
      return
    }
    const done = await compactNow($, o, instructions(clockOf(at), clockOf(cache.end)))
    if (lit !== f.generation) return
    if (done) {
      $.ui.status(`◆ Usage Coach compacted at ${clockOf(at)}, before the cache expired · ${tok(conv)} tokens of conversation`)
      f.hasStatus = true
    } else {
      defuse($, f)
    }
  }))
}
