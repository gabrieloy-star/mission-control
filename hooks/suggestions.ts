// The suggestions: local rules over figures Claude already reports. No model call, no tokens.
// Each one says what to do, how, and roughly what it saves; the strip shows the best one, and
// only suggestions that save at least `minSaving` over an hour of work are shown at all.

import type { Live, Weight } from '../types'
import { SUMMARY_TOKENS, compactUsd, readUsd, rewriteUsd } from './prices'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
/** The 1-hour prompt cache Claude Code writes by default. */
export const CACHE_TTL = HOUR
/** From here every request carries enough to make compacting pay. */
export const HEAVY_AT = 200_000
/** From here, after the cache expired, starting over with a note beats resending. */
export const FRESH_AT = 300_000
/** Failures in a row on the same step that make Claude's loop the first thing to fix. */
export const LOOP_AT = 3
/** Ranking only: requests in an hour of steady work. */
const CALLS_PER_HOUR = 100

export type Settings = {
  minTokens: number
  budget: number
  /** Smallest saving worth suggesting, in dollars over an hour of work. */
  minSaving: number
}

export type Suggestion = {
  id: string
  /** The headline: the action, in plain words. */
  title: string
  /** The strip's words, short. */
  short: string
  /** One or two sentences: why, and the exact step. */
  how: string
  /** Estimated saving in dollars, per `unit`. */
  usd: number
  unit: 'now' | 'per message' | 'per 1,000 messages' | 'per search' | 'over the next 10 messages'
  /** The strip key that does it, when Usage Coach can do it itself. */
  key?: 'c'
  tone: 'calm' | 'warn' | 'hot'
  /** Ranking: the saving over an hour of work. */
  score: number
}

// ---------- Formatting ----------

export function tok(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1e4) return Math.round(n / 1e3) + 'k'
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(n))
}

export function money(usd: number): string {
  if (usd < 0.01) return '< $0.01'
  return usd >= 100 ? '$' + Math.round(usd) : '$' + usd.toFixed(2)
}

export function span(ms: number): string {
  if (ms <= 0) return 'expired'
  const m = ms / MINUTE
  if (m < 1) return '<1m'
  if (m < 60) return Math.round(m) + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + String(Math.round(m % 60)).padStart(2, '0')
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}

export function seconds(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
}

export function clockOf(ts: number): string {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// ---------- Readings ----------

/** How long the prompt cache lives for this session's last request. */
export function ttlOf(live: Live): number {
  return live.cacheTtl ?? CACHE_TTL
}

/** When the prompt cache expires; null before the first request. */
export function cacheEnd(live: Live): number | null {
  return live.cacheAt === null ? null : live.cacheAt + ttlOf(live)
}

/** Time left before the prompt cache expires; null before the first request. */
export function cacheLeft(live: Live, now: number): number | null {
  const end = cacheEnd(live)
  return end === null ? null : end - now
}

/** The cache countdown turns amber from here: a quarter of its life, 15 minutes at most. */
export function cacheWarnAt(live: Live): number {
  return Math.min(15 * MINUTE, ttlOf(live) / 4)
}

/** What a compaction can shrink: the conversation, or the whole context when unknown. */
export function conversationOf(live: Live): number {
  return live.conversation ?? Math.max(0, (live.tokens ?? 0) - (live.fixed ?? 0))
}

function idleServers(live: Live) {
  return live.mcp.filter(s => !live.mcpUsed.includes(s.server))
}

function lastAgent(weights: Weight[]): Weight | undefined {
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]!.isAgent) return weights[i]
  return undefined
}

// ---------- The rules ----------

export function suggestionsOf(live: Live, now: number, s: Settings): Suggestion[] {
  const out: Suggestion[] = []
  const tokens = live.tokens ?? 0
  const conv = conversationOf(live)
  const left = cacheLeft(live, now)
  const end = cacheEnd(live)
  const model = live.model

  // 0. Claude keeps failing the same step: stopping it saves more than any other change.
  const loop = live.loop
  if (loop && loop.count >= LOOP_AT) {
    const spent = live.usd !== null ? Math.max(0, live.usd - loop.usdAtFirst) : 0
    out.push({
      id: 'loop', tone: 'hot', unit: 'now', usd: 0, score: 0,
      title: `Claude failed the same step ${loop.count} times${spent >= 0.01 ? ` (${money(spent)})` : ''}`,
      short: `stuck · ${loop.count} failures`,
      how: `${loop.label} keeps failing. Press Esc to stop Claude, then say what to try instead.`,
    })
  }

  // 1. The cache expired: the next message sends everything again at full price.
  if (left !== null && left <= 0 && tokens > 0) {
    if (tokens >= FRESH_AT) {
      const usd = rewriteUsd(tokens, model) - rewriteUsd((live.fixed ?? 0) + 3_000, model)
      out.push({
        id: 'fresh', tone: 'hot', unit: 'now', usd, score: usd,
        title: 'Start a new session',
        short: 'start fresh',
        how: `The cache expired, so your next message pays ${money(rewriteUsd(tokens, model))} to send all ${tok(tokens)} tokens again. Ask Claude for a short handoff note, type /clear, and paste the note.`,
      })
    } else if (conv >= s.minTokens) {
      // With the cache expired, the compaction itself sends the conversation once at full price.
      const usd = rewriteUsd(conv, model) / 2 - compactUsd(0, model)
      if (usd > 0.01) out.push({
        id: 'cold-compact', tone: 'hot', unit: 'now', usd, score: usd, key: 'c',
        title: 'Compact before your next message',
        short: 'compact first',
        how: `The cache expired, so your next message sends all ${tok(tokens)} tokens again at full price. Compacting first sends a ${tok(SUMMARY_TOKENS)} summary instead. Click compact, or type /compact.`,
      })
    }
  }

  // 2. The cache expires soon: compact while it is still cheap to read.
  if (left !== null && end !== null && left > 0 && left < cacheWarnAt(live) && conv >= s.minTokens) {
    const usd = rewriteUsd(conv, model) - compactUsd(conv, model)
    if (usd > 0.01) out.push({
      id: 'break', tone: 'warn', unit: 'now', usd, score: usd, key: 'c',
      title: 'Compact before the cache expires',
      short: 'compact now',
      how: `The cache expires at ${clockOf(end)}. A message after that pays ${money(rewriteUsd(tokens, model))} to send all ${tok(tokens)} tokens again. Click compact, or type /compact. If you step away, Usage Coach compacts a few minutes before it expires.`,
    })
  }

  // 3. A large context: every message sends all of it.
  if (left !== null && left > 0 && tokens >= HEAVY_AT && conv > SUMMARY_TOKENS * 2) {
    const usd = readUsd(conv - SUMMARY_TOKENS, model)
    out.push({
      id: 'heavy', tone: 'warn', unit: 'per message', usd, score: usd * CALLS_PER_HOUR, key: 'c',
      title: 'Compact to make each message cheaper',
      short: 'compact',
      how: `Every message sends ${tok(tokens)} tokens of context. After compacting it sends about ${tok((live.fixed ?? 0) + SUMMARY_TOKENS)}: ${money(usd)} less per message. Best between tasks. Click compact, or type /compact.`,
    })
  }

  // 4. MCP servers whose tools are sent with every message but never used.
  const idle = idleServers(live)
  const idleTokens = idle.reduce((n, sv) => n + sv.tokens, 0)
  if (idleTokens >= 3_000 && live.turns.length >= 3) {
    const usd = readUsd(idleTokens, model) * 1000
    const names = idle.slice(0, 3).map(sv => sv.server).join(', ') + (idle.length > 3 ? ` and ${idle.length - 3} more` : '')
    out.push({
      id: 'mcp', tone: 'calm', unit: 'per 1,000 messages', usd, score: (usd * CALLS_PER_HOUR) / 1000,
      title: `Turn off ${idle.length} unused MCP server${idle.length === 1 ? '' : 's'}`,
      short: `${idle.length} unused MCP`,
      how: `${names} add ${tok(idleTokens)} tokens to every message and were not used in this session. Type /mcp and disable them for this project.`,
    })
  }

  // 5. A general-purpose subagent spent heavily.
  const agent = lastAgent(live.weights)
  if (agent && agent.agentType === 'general-purpose' && agent.tokens >= 5_000_000 && agent.usd) {
    const usd = agent.usd * 0.7
    out.push({
      id: 'explore', tone: 'calm', unit: 'per search', usd, score: usd / 2,
      title: 'Use the Explore agent for searches',
      short: 'use Explore',
      how: `A general-purpose subagent used ${tok(agent.tokens)} tokens (${money(agent.usd)}). To find code or files, ask Claude to use the Explore agent: it is built for searching and costs less.`,
    })
  }

  // 6. A large tool output is now sent with every message.
  const last = live.weights[live.weights.length - 1]
  if (last && !last.isAgent && last.tokens >= 10_000) {
    const usd = readUsd(last.tokens, model) * 10
    out.push({
      id: 'output', tone: 'calm', unit: 'over the next 10 messages', usd, score: (usd * CALLS_PER_HOUR) / 10,
      title: 'Ask for shorter tool outputs',
      short: 'shorter outputs',
      how: `${last.tool} returned ${tok(last.tokens)} tokens, and every later message sends them again. Next time ask for only the part you need: the last lines, a count, or a filtered list.`,
    })
  }

  // 7. Over budget: said once by a toast; listed here while it holds.
  if (s.budget > 0 && live.usd !== null && live.usd >= s.budget) {
    out.push({
      id: 'budget', tone: 'hot', unit: 'now', usd: 0, score: 0,
      title: 'Session over budget',
      short: 'over budget',
      how: `This session has cost ${money(live.usd)}, over your ${money(s.budget)} budget. Nothing is stopped; a new session starts the count again.`,
    })
  }

  // Small savings are noise: only what saves at least `minSaving` over an hour of work.
  // A failing loop and the budget carry no saving of their own; the loop always comes first.
  const first = (m: Suggestion) => (m.id === 'loop' ? 1 : 0)
  return out
    .filter(m => m.id === 'loop' || m.id === 'budget' || m.score >= s.minSaving)
    .sort((a, b) => first(b) - first(a) || b.score - a.score)
}

/** The suggestion in one line, for the empty prompt and the toast. */
export function tipOf(suggestion: Suggestion | undefined): string | null {
  if (!suggestion) return null
  return `${suggestion.title}${savingOf(suggestion)}${suggestion.key ? ' · click compact' : ''}`
}

/** " · saves about $1.20 per message", or nothing when it saves nothing measurable. */
export function savingOf(suggestion: Suggestion): string {
  if (suggestion.usd <= 0.01) return ''
  return ` · saves about ${money(suggestion.usd)}${suggestion.unit === 'now' ? '' : ' ' + suggestion.unit}`
}
