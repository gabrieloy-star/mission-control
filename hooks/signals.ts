// Signals: the limit forecast, a step Claude keeps failing, cost per task, what compactions
// saved, and the week against the one before. Local rules over figures Claude already reports:
// no model call, no tokens. Pure.

import type { Limit, LimitSample, Loop, Saving, Tokens, Turn, Week } from '../types'
import { HOUR, LOOP_AT, MINUTE } from './moves'
import { tokensUsd } from './prices'

// ---------- Limit forecast ----------

/** Samples kept per usage limit: enough for the last hour at one per message. */
export const KEEP_SAMPLES = 12
/** The pace is read over this much recent time. */
const PACE_WINDOW = HOUR
/** Fewer samples, or a shorter stretch, says nothing about the pace. */
const PACE_SAMPLES = 3
const PACE_SPAN = 15 * MINUTE

/** Adds one reading; a drop means the window reset, which starts the samples over. */
export function sampleLimit(list: LimitSample[] | undefined, at: number, pct: number): LimitSample[] {
  const prev = list ?? []
  const last = prev[prev.length - 1]
  if (last && pct < last.pct) return [{ at, pct }]
  return [...prev, { at, pct }].slice(-KEEP_SAMPLES)
}

export type Pace = {
  /** When the limit runs out at the current pace. */
  runsOutAt: number
  /** When the window resets; null when Claude did not say. */
  resetsAt: number | null
  /** True when it runs out before it resets: the only case worth a warning. */
  isShort: boolean
  tone: 'calm' | 'warn' | 'hot'
  /** Percentage points used per hour at this pace. */
  perHour: number
}

export function paceOf(limit: Limit, samples: LimitSample[] | undefined, now: number): Pace | null {
  const recent = (samples ?? []).filter(s => now - s.at <= PACE_WINDOW)
  if (recent.length < PACE_SAMPLES) return null
  const first = recent[0]!, last = recent[recent.length - 1]!
  if (last.at - first.at < PACE_SPAN) return null
  const slope = (last.pct - first.pct) / (last.at - first.at)
  if (slope <= 0) return null
  const used = Math.min(100, Math.max(0, limit.percentUsed))
  const runsOutAt = now + (100 - used) / slope
  const reset = Date.parse(limit.resetsAt ?? '')
  const resetsAt = Number.isNaN(reset) ? null : reset
  const isShort = resetsAt !== null && runsOutAt < resetsAt
  const tone = !isShort ? 'calm' : resetsAt! - runsOutAt >= 30 * MINUTE ? 'hot' : 'warn'
  return { runsOutAt, resetsAt, isShort, tone, perHour: slope * HOUR }
}

/** "5-hour limit", "weekly limit". */
export function limitName(kind: string): string {
  return kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? 'weekly limit' : kind.replace(/_/g, ' ') + ' limit'
}

// ---------- A step Claude keeps failing ----------

export { LOOP_AT }

/** The step a tool call works on, so the same failure reads as the same step. */
export function stepOf(tool: string, input: any): { key: string; label: string } {
  if (tool === 'Bash' && typeof input?.command === 'string') {
    const label = input.command.replace(/\s+/g, ' ').trim()
    const key = label.replace(/\d+/g, '#').slice(0, 80)
    return { key: 'Bash:' + key, label: label.length > 48 ? label.slice(0, 47) + '…' : label }
  }
  const file = input?.file_path ?? input?.notebook_path
  if (typeof file === 'string') return { key: `${tool}:${file}`, label: `${tool} ${file.split('/').slice(-2).join('/')}` }
  return { key: tool, label: tool }
}

/** The streak after one more tool call: a success, or another step, starts it over. */
export function loopStep(prev: Loop | null | undefined, step: { key: string; label: string }, isError: boolean, usdNow: number): Loop | null {
  if (!isError) return null
  if (prev && prev.key === step.key) return { ...prev, count: prev.count + 1 }
  return { key: step.key, label: step.label, count: 1, usdAtFirst: usdNow, isTold: false }
}

// ---------- Cost per task ----------

export type Task = {
  /** Your request's first words; empty when the session started without one. */
  prompt: string
  /** When it started, from the first message's end minus its duration. */
  at: number
  usd: number
  tools: number
  messages: number
  isCold: boolean
  agentShare: number
}

/** Your request in one short line. */
export function promptLine(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/** Groups the session's messages by your request: a message with no text of yours continues the last one. */
export function tasksOf(turns: Turn[]): Task[] {
  const out: Task[] = []
  for (const t of turns) {
    const cur = out[out.length - 1]
    if (cur && !t.prompt) {
      const usd = cur.usd + t.usd
      cur.agentShare = usd > 0 ? (cur.agentShare * cur.usd + t.agentShare * t.usd) / usd : 0
      cur.usd = usd
      cur.tools += t.tools ?? 0
      cur.messages++
      cur.isCold ||= t.isCold
      continue
    }
    out.push({ prompt: t.prompt ?? '', at: t.at - t.ms, usd: t.usd, tools: t.tools ?? 0, messages: 1, isCold: t.isCold, agentShare: t.agentShare })
  }
  return out
}

// ---------- What compactions saved ----------

export const SAVINGS_KEY = 'savings'
const WEEK = 7 * 24 * HOUR

/** Adds or replaces one entry, and drops entries older than 7 days. */
export function recordSaving(list: Saving[] | null | undefined, entry: Saving, now: number): Saving[] {
  const kept = (list ?? []).filter(s => s.id !== entry.id && now - s.at < WEEK)
  return [...kept, entry]
}

export function savedThisWeek(list: Saving[] | null | undefined, now: number): { usd: number; count: number } {
  const week = (list ?? []).filter(s => now - s.at < WEEK && s.usd > 0)
  return { usd: week.reduce((n, s) => n + s.usd, 0), count: week.length }
}

// ---------- The week against the one before ----------

function usdOf(byModel: Record<string, Tokens> | undefined): number {
  let usd = 0
  for (const [model, t] of Object.entries(byModel ?? {})) usd += tokensUsd(t, model)
  return usd
}

export type Trend = {
  usd: number
  prevUsd: number
  /** The change, as a share of the week before: 0.4 is 40% more. */
  change: number
  /** The project behind most of the difference, and its share of it. */
  project: string | null
  projectShare: number
}

/** Shown from $5 a week on both sides and a change of 20% or more. */
const TREND_MIN_USD = 5
const TREND_MIN_CHANGE = 0.2

export function trendOf(w: Week | null): Trend | null {
  if (!w?.prev) return null
  const usd = usdOf(w.main) + usdOf(w.sub)
  const prevUsd = usdOf(w.prev.main) + usdOf(w.prev.sub)
  if (usd < TREND_MIN_USD || prevUsd < TREND_MIN_USD) return null
  const change = (usd - prevUsd) / prevUsd
  if (Math.abs(change) < TREND_MIN_CHANGE) return null
  const diff = usd - prevUsd
  let project: string | null = null
  let best = 0
  for (const [name, p] of Object.entries(w.byProject ?? {})) {
    const d = usdOf(p.cur) - usdOf(p.prev)
    if (Math.sign(d) === Math.sign(diff) && Math.abs(d) > Math.abs(best)) {
      best = d
      project = name
    }
  }
  return { usd, prevUsd, change, project, projectShare: project ? Math.min(1, best / diff) : 0 }
}

/** What today cost across sessions: the scanner's count, plus this session since it ran. */
export function todayUsd(w: Week | null, sessionUsd: number | null): number | null {
  if (!w?.today) return null
  const since = sessionUsd !== null && w.sessionUsdAtScan !== undefined ? Math.max(0, sessionUsd - w.sessionUsdAtScan) : 0
  return usdOf(w.today) + since
}
