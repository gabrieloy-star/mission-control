// Insights: whether the model fits the work, and habits that keep sessions cheap. Local rules
// over figures Claude already reports, like the suggestions: no model call, no tokens. Pure.

import type { Live, Turn, Week } from '../types'
import { familyWeek } from './strip'
import { money, tok } from './moves'
import { priceOf, rewriteUsd, sumTokens, tokensUsd } from './prices'

export type Insight = {
  id: string
  kind: 'model' | 'habit'
  tone: 'calm' | 'warn' | 'hot'
  title: string
  /** Why, and the exact step. */
  how: string
}

/** Turns the model rules look at: the latest ones, answered by the current model. */
const RECENT = 8
/** Fewer turns than this say nothing about the kind of work. */
const ENOUGH = 4

const NAMES: Record<string, string> = { fable: 'Fable', mythos: 'Mythos', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }

export function familyOf(model: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)/.exec(model)
  return m ? m[1]! : ''
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`. */
export function modelName(model: string): string {
  const id = model.replace(/\[.*\]$/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const [family, ...v] = id.split('-')
  return family ? `${NAMES[family] ?? family} ${v.join('.')}`.trim() : model
}

function median(list: number[]): number {
  if (!list.length) return 0
  const s = [...list].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** "half", "a fifth", or "40%": what `cheap` costs per input token next to `dear`. */
function share(cheap: string, dear: string): string {
  const r = priceOf(cheap).input / priceOf(dear).input
  if (Math.abs(r - 0.5) < 0.03) return 'half the price'
  if (Math.abs(r - 0.2) < 0.02) return 'a fifth of the price'
  if (Math.abs(r - 0.25) < 0.02) return 'a quarter of the price'
  return `${Math.round(r * 100)}% of the price`
}

/** What switching models costs once: the new model has no cache, so it writes the context again. */
function switchCost(live: Live, to: string): string {
  return live.tokens ? money(rewriteUsd(live.tokens, to)) : 'one full resend'
}

export function insightsOf(live: Live, week: Week | null): Insight[] {
  const out: Insight[] = []
  const model = live.model
  const family = familyOf(model)
  const recent: Turn[] = live.turns.filter(t => !t.model || t.model === model).slice(-RECENT)
  const measured = recent.filter(t => t.out !== undefined && t.tools !== undefined)

  // ---------- Model fit ----------
  if (measured.length >= ENOUGH) {
    const outs = median(measured.map(t => t.out!))
    const tools = median(measured.map(t => t.tools!))
    const isLight = outs < 1_500 && tools <= 2
    const isRoutine = outs < 4_000 && tools <= 6

    if ((family === 'fable' || family === 'mythos') && isRoutine) {
      const to = 'claude-opus-5-5'
      out.push({
        id: 'model-fable', kind: 'model', tone: 'warn',
        title: `${modelName(model)} may be more than this work needs`,
        how: `Your last ${measured.length} messages were routine: about ${tok(outs)} tokens written and ${tools} tool calls each. Opus 5.5 handles this at ${share(to, model)}. ` +
          `Type /model opus at the start of the next task; switching mid-task sends the context again once (${switchCost(live, to)}). Keep ${NAMES[family]} for the hardest problems.`,
      })
    } else if (family === 'opus' && isLight) {
      const to = 'claude-sonnet-5-5'
      out.push({
        id: 'model-opus', kind: 'model', tone: 'calm',
        title: 'Sonnet would do for quick questions',
        how: `Your last ${measured.length} messages were short: about ${tok(outs)} tokens written and ${tools} tool calls each. Sonnet 5.5 answers these well at ${share(to, model)}. ` +
          `Type /model sonnet at the start of the next task; switching mid-task sends the context again once (${switchCost(live, to)}).`,
      })
    } else if (family === 'haiku' && tools >= 12) {
      out.push({
        id: 'model-haiku', kind: 'model', tone: 'calm',
        title: 'Long tasks may finish sooner on Sonnet',
        how: `Your last ${measured.length} messages took about ${tools} tool calls each. If Haiku needs retries or redoes work, Sonnet 5.5 often gets there in fewer steps, which can cost less overall. Type /model sonnet.`,
      })
    }
  }

  // Subagents on a top-tier model doing search work.
  const dear = live.weights.filter(w => w.isAgent && w.model && /fable|mythos|opus/.test(w.model) && w.agentType !== 'Plan')
  if (dear.length >= 2) {
    const usd = dear.reduce((n, w) => n + (w.usd ?? 0), 0)
    const top = dear[dear.length - 1]!
    out.push({
      id: 'model-agents', kind: 'model', tone: usd >= 5 ? 'warn' : 'calm',
      title: 'Subagents can run on a lighter model',
      how: `${dear.length} subagents ran on ${modelName(top.model!)} (${money(usd)}). For searching and reading files, ask Claude to run them on Haiku or Sonnet ("use a haiku subagent"); keep the main conversation on ${modelName(model || top.model!)}.`,
    })
  }

  // The week's top-tier share.
  if (week) {
    let total = 0
    for (const byModel of [week.main, week.sub]) for (const [m, t] of Object.entries(byModel)) if (sumTokens(t)) total += tokensUsd(t, m)
    const fable = familyWeek(week, 'fable')
    if (total > 0 && fable.usd / total >= 0.5 && fable.usd >= 20) {
      out.push({
        id: 'model-week', kind: 'model', tone: 'warn',
        title: `Fable made ${Math.round((fable.usd / total) * 100)}% of your 7-day cost`,
        how: `${money(fable.usd)} of ${money(total)} at list prices. Fable is for the hardest problems; Opus 5.5 costs ${share('claude-opus-5-5', 'claude-fable-5-1')} per token for everyday coding.`,
      })
    }
  }

  // ---------- Habits ----------
  const turns = live.turns
  if (turns.length >= 5) {
    const cached = turns.reduce((n, t) => n + t.cached, 0) / turns.length
    if (cached < 0.8) out.push({
      id: 'habit-cache', kind: 'habit', tone: 'warn',
      title: `Only ${Math.round(cached * 100)}% of input came from the cache`,
      how: 'Cached input costs a tenth of the price or less. Pauses longer than the cache lasts, switching models and editing CLAUDE.md mid-session all start it over.',
    })
    const expired = turns.filter(t => t.isCold)
    if (expired.length >= 2) out.push({
      id: 'habit-expired', kind: 'habit', tone: 'warn',
      title: `${expired.length} times the cache had expired when you came back`,
      how: `Those messages cost ${money(expired.reduce((n, t) => n + t.usd, 0))}. Before a long break, compact (press c) or leave idle compact on in the settings.`,
    })
    const agents = turns.reduce((n, t) => n + t.agentShare, 0) / turns.length
    if (agents >= 0.5) out.push({
      id: 'habit-agents', kind: 'habit', tone: 'calm',
      title: `Subagents spent ${Math.round(agents * 100)}% of this session`,
      how: 'Each subagent starts from zero and reads files again. Give it a narrow brief (which folder, what to return) and use Explore for searches.',
    })
  }
  if (live.fixed !== null && live.fixed >= 30_000) out.push({
    id: 'habit-fixed', kind: 'habit', tone: 'calm',
    title: `${tok(live.fixed)} tokens are sent before your first word`,
    how: 'Instructions, tools, skills, memory and MCP servers ride on every message. Trim long CLAUDE.md files and turn off MCP servers this project does not use (/mcp). The Context tab shows the split.',
  })
  if (live.tokens !== null && live.window && live.tokens / live.window >= 0.6) out.push({
    id: 'habit-clear', kind: 'habit', tone: 'calm',
    title: 'Start new tasks in a new session',
    how: `The context is at ${Math.round((live.tokens / live.window) * 100)}%. When you move to an unrelated task, type /clear: the new task does not need the old conversation, and every message gets cheaper.`,
  })

  return out
}

/** Standing advice, shown under the insights. */
export const HABITS: string[] = [
  'Type /clear between unrelated tasks; /compact when you want to keep going on the same one.',
  'Use plan mode (shift+tab) for big changes: agreeing on the plan first avoids paying for rework.',
  'Point Claude at the files you mean instead of asking it to look around.',
  'Ask for the part of a log or output you need, not the whole thing.',
]
