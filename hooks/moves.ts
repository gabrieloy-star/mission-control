// The moves: eight local rules over figures Claude already reports. No model call, no tokens.
// Each move says what to do, how, and roughly what it saves; the strip shows the best one.

import type { Live, Weight } from '../types'
import { SUMMARY_TOKENS, compactUsd, readUsd, rewriteUsd } from './prices'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
/** The fuse turns amber this long before the cache cools. */
export const FUSE_WARN = 15 * MINUTE
/** From here every request carries enough to make compacting pay. */
export const HEAVY_AT = 200_000
/** From here a cold return costs more than starting over with a note. */
export const FRESH_AT = 300_000
/** Ranking only: requests in an hour of steady work. */
const CALLS_PER_HOUR = 100

export type Money = { currency: 'USD' | 'BRL'; brlPerUsd: number }
export type Settings = { minTokens: number; money: Money; budget: number }

export type Move = {
  id: string
  /** The pane's headline. */
  title: string
  /** The strip's words, short. */
  short: string
  /** One or two sentences: why, and the exact step. */
  how: string
  /** Estimated saving in dollars, per `unit`. */
  usd: number
  unit: 'now' | 'per call' | 'per 1k calls' | 'per search' | 'next 10 calls'
  /** The strip key that does it, when Mission Control can do it itself. */
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

export function money(usd: number, m: Money): string {
  if (m.currency === 'BRL') {
    const brl = usd * m.brlPerUsd
    if (brl < 0.01) return '< R$ 0,01'
    return 'R$ ' + (brl >= 100 ? String(Math.round(brl)) : brl.toFixed(2).replace('.', ','))
  }
  if (usd < 0.01) return '< $0.01'
  return usd >= 100 ? '$' + Math.round(usd) : '$' + usd.toFixed(2)
}

export function span(ms: number): string {
  if (ms <= 0) return 'cold'
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

/** Time the prompt cache stays warm; null before the first request. */
export function fuseLeft(live: Live, now: number): number | null {
  return live.cacheAt === null ? null : live.cacheAt + HOUR - now
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

export function movesOf(live: Live, now: number, s: Settings): Move[] {
  const out: Move[] = []
  const m = s.money
  const tokens = live.tokens ?? 0
  const conv = conversationOf(live)
  const left = fuseLeft(live, now)
  const model = live.model

  // 1. Cold cache: the next message writes everything again.
  if (left !== null && left <= 0 && tokens > 0) {
    if (tokens >= FRESH_AT) {
      const usd = rewriteUsd(tokens, model) - rewriteUsd((live.fixed ?? 0) + 3_000, model)
      out.push({
        id: 'fresh', tone: 'hot', unit: 'now', usd, score: usd,
        title: 'Orbit decayed: launch a fresh thread',
        short: 'fresh thread',
        how: `The cache went cold. Your next message would write all ${tok(tokens)} again (${money(rewriteUsd(tokens, model), m)}). Ask Claude for a short handoff note, type /clear, and paste the note.`,
      })
    } else if (conv >= s.minTokens) {
      // Cold, the compaction itself sends the conversation once uncached (half a rewrite).
      const usd = rewriteUsd(conv, model) / 2 - compactUsd(0, model)
      if (usd > 0.01) out.push({
        id: 'cold-compact', tone: 'hot', unit: 'now', usd, score: usd, key: 'c',
        title: 'Orbit decayed: compact before you continue',
        short: 'compact first',
        how: `The cache went cold: the next message writes ${tok(tokens)} again. Compacting first writes a ${tok(SUMMARY_TOKENS)} summary instead. Press c on the strip, or type /compact.`,
      })
    }
  }

  // 2. Fuse short: compact while the cache is still warm.
  if (left !== null && left > 0 && left < FUSE_WARN && conv >= s.minTokens) {
    const usd = rewriteUsd(conv, model) - compactUsd(conv, model)
    if (usd > 0.01) out.push({
      id: 'break', tone: 'warn', unit: 'now', usd, score: usd, key: 'c',
      title: 'Compact before the orbit decays',
      short: 'compact now',
      how: `The cache stays warm until ${clockOf(live.cacheAt! + HOUR)}. Coming back after that rewrites ${tok(tokens)} (${money(rewriteUsd(tokens, model), m)}). Press c on the strip; if you are away, the autopilot compacts first.`,
    })
  }

  // 3. A heavy tank: every request re-reads all of it.
  if (left !== null && left > 0 && tokens >= HEAVY_AT && conv > SUMMARY_TOKENS * 2) {
    const usd = readUsd(conv - SUMMARY_TOKENS, model)
    out.push({
      id: 'heavy', tone: 'warn', unit: 'per call', usd, score: usd * CALLS_PER_HOUR, key: 'c',
      title: 'Lighten the payload',
      short: 'compact',
      how: `Every request carries ${tok(tokens)}. Compacting leaves about ${tok((live.fixed ?? 0) + SUMMARY_TOKENS)}: ${money(usd, m)} less per request. Best between tasks. Press c on the strip.`,
    })
  }

  // 4. MCP servers whose tools ride along unused.
  const idle = idleServers(live)
  const idleTokens = idle.reduce((n, sv) => n + sv.tokens, 0)
  if (idleTokens >= 3_000 && live.turns.length >= 3) {
    const usd = readUsd(idleTokens, model) * 1000
    const names = idle.slice(0, 3).map(sv => sv.server).join(', ') + (idle.length > 3 ? ` and ${idle.length - 3} more` : '')
    out.push({
      id: 'mcp', tone: 'calm', unit: 'per 1k calls', usd, score: (usd * CALLS_PER_HOUR) / 1000,
      title: `Power down ${idle.length} idle MCP module${idle.length === 1 ? '' : 's'}`,
      short: `${idle.length} idle MCP`,
      how: `${names} add ${tok(idleTokens)} to every request and were not used this session. Type /mcp and disable them for this project.`,
    })
  }

  // 5. A broad subagent spent heavily.
  const agent = lastAgent(live.weights)
  if (agent && agent.agentType === 'general-purpose' && agent.tokens >= 5_000_000 && agent.usd) {
    const usd = agent.usd * 0.7
    out.push({
      id: 'explore', tone: 'calm', unit: 'per search', usd, score: usd / 2,
      title: 'Send Explore probes for searches',
      short: 'use Explore',
      how: `A general-purpose probe (subagent) used ${tok(agent.tokens)} (${money(agent.usd, m)}). For finding code or files, ask for the Explore agent: it is built for searching and runs lighter.`,
    })
  }

  // 6. A big tool output now rides on every request.
  const last = live.weights[live.weights.length - 1]
  if (last && !last.isAgent && last.tokens >= 10_000) {
    const usd = readUsd(last.tokens, model) * 10
    out.push({
      id: 'output', tone: 'calm', unit: 'next 10 calls', usd, score: (usd * CALLS_PER_HOUR) / 10,
      title: 'Heavy cargo: trim big outputs',
      short: 'trim outputs',
      how: `${last.label} brought ${tok(last.tokens)} on board; every later request re-reads it. Next time ask for the tail, a count or a filter.`,
    })
  }

  // 7. Over budget: said once by a toast; listed here while it holds.
  if (s.budget > 0 && live.usd !== null) {
    const shown = m.currency === 'BRL' ? live.usd * m.brlPerUsd : live.usd
    if (shown >= s.budget) out.push({
      id: 'budget', tone: 'hot', unit: 'now', usd: 0, score: 0,
      title: 'Over mission budget',
      short: 'over budget',
      how: `This session is at ${money(live.usd, m)}. Nothing is stopped; a fresh session starts the count again.`,
    })
  }

  return out.sort((a, b) => b.score - a.score)
}

/** The tip for the empty prompt: the best move, in one line. */
export function tipOf(move: Move | undefined, m: Money): string | null {
  if (!move) return null
  const saving = move.usd > 0.01 ? ` · saves ≈ ${money(move.usd, m)}${move.unit === 'now' ? '' : ' ' + move.unit}` : ''
  return `${move.title}${saving}${move.key ? ` · press ${move.key} on the strip` : ''}`
}
