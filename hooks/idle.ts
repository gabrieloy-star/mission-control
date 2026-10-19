// The idle fuse: after the last message, a countdown, then one compaction before the prompt
// cache cools, only when the conversation is big enough for a cold return to cost real money.

import type { EngineInterface } from 'claude-code'
import { HOUR, MINUTE, clockOf, tok } from './moves'

export type Fuse = {
  generation: number
  timers: { cancel(): void }[]
  hasStatus: boolean
}

export type FuseOptions = {
  idleMs: number
  minTokens: number
  /** The conversation's tokens now: what a compaction shrinks. */
  conversation: () => Promise<number | null>
  onCompacted: (before: number, after: number | undefined) => Promise<void>
}

/** The countdown starts this long before the compaction. */
const WARN_BEFORE = 5 * MINUTE

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

function instructions(at: string, minutes: number) {
  return `Mission Control compacted this idle session at ${at}, ${minutes} minutes after the last message, so the next message does not pay to write the whole conversation again. ` +
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

/** Lights the fuse at the end of a main-loop turn. */
export async function light($: EngineInterface, f: Fuse, o: FuseOptions) {
  defuse($, f)
  if (o.idleMs <= 0) return
  const lit = f.generation
  const since = await $.clock.now()
  const fireAt = since + o.idleMs

  const warnIn = Math.max(0, o.idleMs - WARN_BEFORE)
  f.timers.push($.clock.after(warnIn, async () => {
    if (lit !== f.generation) return
    const conv = await o.conversation().catch(() => null)
    if (conv === null || conv < o.minTokens) return
    $.ui.status(`◆ Autopilot: compacting at ${clockOf(fireAt)} unless you are back · ${tok(conv)} conversation`)
    f.hasStatus = true
  }))

  f.timers.push($.clock.after(o.idleMs, async () => {
    if (lit !== f.generation) return
    const now = await $.clock.now()
    // A timer that fires late (the Mac slept) finds the cache cold: compacting then saves nothing.
    if (now > since + HOUR) {
      $.ui.log(`◆ Autopilot: no compaction, the Mac slept past the orbit's hour`)
      defuse($, f)
      return
    }
    const conv = await o.conversation().catch(() => null)
    if (conv === null || conv < o.minTokens) {
      defuse($, f)
      return
    }
    const minutes = Math.round((now - since) / MINUTE)
    const done = await compactNow($, o, instructions(clockOf(now), minutes))
    if (lit !== f.generation) return
    if (done) {
      $.ui.status(`◆ Autopilot compacted at ${clockOf(now)} after ${minutes} min idle · ${tok(conv)} conversation`)
      f.hasStatus = true
    } else {
      defuse($, f)
    }
  }))
}
