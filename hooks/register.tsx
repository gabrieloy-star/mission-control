// Mission Control: where your tokens go, and the one move that saves the most right now.
//   The strip above the prompt: tank (context), fuse (prompt cache), race (5h and 7d limits),
//   spend, and the move, on one key. A ledger line after each answer. A weight under heavy
//   tool outputs and every subagent. A tip in the empty prompt. The side pane (/mission).
//   The idle fuse compacts a quiet session before its cache cools.
// It only reads figures Claude already reports and never writes into the conversation:
// watching costs no tokens. The one thing that spends is a compaction, when it saves more.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Category, Live, Tab, Tokens, Turn, Week, Weight } from '../types'
import { HOUR, MINUTE, conversationOf, money, movesOf, seconds, tipOf, tok } from './moves'
import type { Settings } from './moves'
import { sumTokens, tokensUsd } from './prices'
import { drawStrip } from './strip'
import { drawPane } from './pane'
import { compactNow, defuse, light, newFuse } from './idle'
import type { FuseOptions } from './idle'

const PLUGIN = 'mission-control'
const PANE = 'mission'
const PANE_COLUMNS = 56
const WEEK_KEY = 'week'
const WEEK_FRESH = 2 * HOUR
const TOAST_GAP = 10 * MINUTE
const KEEP_TURNS = 60
const KEEP_WEIGHTS = 40
const HEAVY_OUTPUT = 10_000

const EMPTY: Live = {
  startedAt: null, tokens: null, window: 200_000, fixed: null, conversation: null, adds: [], cacheAt: null, model: '',
  limits: [], usd: null, turnBase: null, turns: [], weights: [], mcp: [], mcpUsed: [], budgetWarned: false, lastToastAt: 0,
}

const live = atom({ plugin: 'mission-control', key: 'live' } as const, EMPTY as Live)
const tab = atom({ plugin: 'mission-control', key: 'tab' } as const, 'moves' as Tab)
const week = atom({ plugin: 'mission-control', key: 'week' } as const, null as Week | null)
const weekBusy = atom({ plugin: 'mission-control', key: 'weekBusy' } as const, false)
const categories = atom({ plugin: 'mission-control', key: 'categories' } as const, [] as Category[])

/** The window compaction is measured against (a smaller compaction window when one is set). */
let effectiveWindow: number | null = null

// Per-turn tallies: they only live between turn.start and turn.complete.
let turnStartTokens: number | null = null
let turnRead = 0
let turnInput = 0
let turnAgentUsd = 0
let turnCold = false
/** A main-loop turn is running: a compaction now would be refused, so the strip queues one. */
let isTurnRunning = false
let isCompactQueued = false
let firstStep = true
let ticker: { cancel(): void } | null = null
const fuse = newFuse()

// ---------- Settings ----------

function settingsOf(options: Record<string, unknown> | undefined): Settings & { idleMs: number; telemetry: boolean } {
  const o = options ?? {}
  return {
    budget: typeof o.budget === 'number' && o.budget > 0 ? o.budget : 0,
    minTokens: typeof o.minTokens === 'number' && o.minTokens >= 0 ? o.minTokens : 40_000,
    idleMs: (typeof o.idleMinutes === 'number' && o.idleMinutes >= 0 ? o.idleMinutes : 50) * MINUTE,
    telemetry: o.telemetry === true,
  }
}

// ---------- Readings ----------

/** The window broken down as /context does, estimated locally: no request, no tokens. */
async function readBreakdown($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return
  if (b.rawMaxTokens > 0) effectiveWindow = b.rawMaxTokens
  const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  const messages = used.find(c => c.name === 'Messages')?.tokens ?? null
  const fixed = used.filter(c => c.name !== 'Messages').reduce((n, c) => n + c.tokens, 0)
  const servers = new Map<string, number>()
  for (const t of b.mcpTools) if (t.isLoaded) servers.set(t.serverName, (servers.get(t.serverName) ?? 0) + t.tokens)
  await update($, categories, () => used.map(c => ({ name: c.name, tokens: c.tokens })).sort((a, z) => z.tokens - a.tokens))
  await update($, live, l => ({
    ...l,
    fixed,
    conversation: messages,
    window: effectiveWindow ?? l.window,
    model: l.model || b.model,
    mcp: [...servers].map(([server, tokens]) => ({ server, tokens })),
  }))
}

async function readUsage($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  await update($, live, l => ({
    ...l,
    startedAt: u.startedAt ?? l.startedAt,
    tokens: u.context.tokens ?? l.tokens,
    window: effectiveWindow ?? (u.context.window || l.window),
    limits: u.rateLimits.length ? [...u.rateLimits] : l.limits,
    usd: u.cost?.usd ?? l.usd,
  }))
}

/** The conversation's size for the idle fuse, fresh. */
async function conversationNow($: EngineInterface): Promise<number | null> {
  await readBreakdown($).catch(() => {})
  const l = await read($, live)
  return l.tokens === null && l.conversation === null ? null : conversationOf(l)
}

// ---------- Actions ----------

const ASKED = 'The user asked Mission Control to compact now to keep the next messages cheap. Preserve open tasks, decisions with their reasons, pending follow-ups, files touched, and anything the user asked to keep.'

/** Compacts now when Claude is idle; while a turn runs, queues /compact to run as soon as it ends. */
async function compactFromStrip($: EngineInterface, o: FuseOptions) {
  if (isTurnRunning) {
    if (isCompactQueued) return $.ui.toast('Mission Control: the compaction is already queued')
    isCompactQueued = true
    $.ui.toast('Mission Control: compaction queued, it runs as soon as Claude finishes this message')
    void $.command.run({ command: 'compact', args: ASKED })
      .catch(() => $.ui.toast('Mission Control: the queued compaction did not run. Type /compact'))
      .finally(() => { isCompactQueued = false })
    return
  }
  const conv = await o.conversation().catch(() => null)
  if (conv !== null && conv < 5_000) return $.ui.toast(`Mission Control: only ${tok(conv)} of conversation, nothing worth compacting yet`)
  const done = await compactNow($, o, ASKED)
  if (!done) $.ui.toast('Mission Control: the compaction did not run. Type /compact')
}

async function togglePane($: EngineInterface) {
  // A pane waiting undrawn counts as closed: pressing opens it, never closes it.
  const mine = (await $.ui.panes()).find(p => p.id === PANE)
  if (mine && mine.isPlaced) {
    await $.ui.close({ id: PANE })
    return
  }
  await readBreakdown($).catch(() => {})
  const opened = await $.ui.open({ id: PANE, title: 'Mission Control', columns: PANE_COLUMNS })
  if (!opened.isPlaced) $.ui.toast(`Mission Control: the pane did not open here (${(opened as any).reason ?? 'no room'})`)
}

const NODES = ['/opt/homebrew/bin/node', '/usr/local/bin/node', 'node']

async function readWeek($: EngineInterface, force = false) {
  if (await read($, weekBusy)) return
  const kept = await read($, week)
  const now = await $.clock.now()
  if (!force && kept && now - kept.at < WEEK_FRESH) return
  await update($, weekBusy, () => true)
  try {
    const script = `${$.plugin.root}/scripts/week.mjs`
    for (const node of NODES) {
      try {
        const run = await $.process.run([node, script, '--days', '7'], { timeoutMs: 180_000 })
        if (run.exitCode !== 0 || run.isStdoutTruncated) continue
        const next: Week = { ...JSON.parse(run.stdout), at: await $.clock.now() }
        await update($, week, () => next)
        await $.store.set(WEEK_KEY, next)
        return
      } catch {
        // This node is missing: try the next one.
      }
    }
    $.ui.toast('Mission Control: could not read the week (Node.js not found)')
  } finally {
    await update($, weekBusy, () => false)
  }
}

async function toastOnce($: EngineInterface, text: string) {
  const now = await $.clock.now()
  const l = await read($, live)
  if (now - l.lastToastAt < TOAST_GAP) return
  await update($, live, x => ({ ...x, lastToastAt: now }))
  $.ui.toast(text)
}

// ---------- Weights ----------

function mcpServerOf(tool: string): string | null {
  const m = /^mcp__(.+?)__/.exec(tool)
  return m ? m[1]! : null
}

function labelOf(tool: string, input: any): string {
  const s = input?.description ?? input?.command ?? input?.file_path ?? input?.pattern ?? input?.url ?? input?.query ?? ''
  const text = String(s).replace(/\s+/g, ' ').trim()
  return text.length > 48 ? text.slice(0, 47) + '…' : text || tool
}

function weightOf(id: string, tool: string, input: any, result: any): Weight | null {
  if (tool === 'Agent' && result && typeof result.totalTokens === 'number') {
    const u = result.usage ?? {}
    const sample: Tokens = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      write5m: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      write1h: u.cache_creation?.ephemeral_1h_input_tokens ?? u.cache_creation_input_tokens ?? 0,
    }
    const model = result.resolvedModel ?? ''
    // The usage sample sets the mix of token kinds; totalTokens scales it to the whole run.
    const per = sumTokens(sample) ? tokensUsd(sample, model) / sumTokens(sample) : 0
    return {
      id, tool, isAgent: true, label: labelOf(tool, input), tokens: result.totalTokens,
      usd: per * result.totalTokens, ms: result.totalDurationMs, model, agentType: result.agentType ?? input?.subagent_type,
    }
  }
  let size = 0
  try {
    size = Math.round(JSON.stringify(result ?? '').length / 4)
  } catch {
    return null
  }
  return size >= HEAVY_OUTPUT ? { id, tool, isAgent: false, label: labelOf(tool, input), tokens: size } : null
}

// ---------- Hooks ----------

let settings = settingsOf(undefined)

function fuseFor($: EngineInterface): FuseOptions {
  return {
    idleMs: settings.idleMs,
    minTokens: settings.minTokens,
    conversation: () => conversationNow($),
    onCompacted: async () => $.ui.invalidate('ui.render'),
  }
}

export const register: Register = (on, options) => {
  settings = settingsOf(options as Record<string, unknown>)
  const s = settings

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'mission', description: 'Mission Control: where your tokens go, and the move that saves the most' })
    ticker?.cancel()
    // The fuse and the race move with the clock.
    ticker = $.clock.every(30_000, () => $.ui.invalidate('ui.render'))
    try {
      await readUsage($)
      await readBreakdown($)
      const kept = (await $.store.get(WEEK_KEY)) as Week | null
      if (kept && Number.isFinite(kept.at)) await update($, week, () => kept)
      // The ⋯ card shows the week's Fable use: refresh a stale week in the background (local, no tokens).
      void readWeek($).catch(() => {})
    } catch {
      // The strip fills in after the first answer.
    }
    $.ui.invalidate('ui.render')
    return result
  })

  // Answered here, so nothing reaches the model: the command costs no tokens.
  on('command.run', { command: 'mission' }, async $ => {
    await togglePane($)
    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      defuse($, fuse)
      isTurnRunning = true
      const l = await read($, live)
      turnStartTokens = l.tokens
      turnRead = 0
      turnInput = 0
      turnAgentUsd = 0
      turnCold = false
      firstStep = true
      await update($, live, x => ({ ...x, turnBase: x.usd }))
    }
    return next(e)
  })

  // Each request of the main loop: the cache figures.
  on('turn.step', async function* ($, e, next) {
    const at = await $.clock.now()
    const response = yield* next(e)
    if (!e.agentId) {
      const u: any = response?.usage
      if (u) {
        const read = u.cache_read_input_tokens ?? 0
        const write = u.cache_creation_input_tokens ?? 0
        turnRead += read
        turnInput += read + write + (u.input_tokens ?? 0)
        if (firstStep && write > 50_000 && read < write) turnCold = true
      }
      firstStep = false
      await update($, live, x => ({ ...x, cacheAt: at, model: e.model || x.model }))
    }
    return response
  })

  on('tool.call', async ($, e, next) => {
    const ran: any = await next(e)
    try {
      const server = mcpServerOf(e.tool)
      if (server) {
        const l = await read($, live)
        if (!l.mcpUsed.includes(server)) await update($, live, x => ({ ...x, mcpUsed: [...x.mcpUsed, server] }))
      }
      if (!(e as any).agentId && ran && ran.result !== undefined) {
        const w = weightOf(e.tool_use_id, e.tool, (e as any).input, ran.result)
        if (w) {
          if (w.isAgent) turnAgentUsd += w.usd ?? 0
          await update($, live, x => ({ ...x, weights: [...x.weights, w].slice(-KEEP_WEIGHTS) }))
        }
      }
    } catch {
      // A weight never fails a tool call.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    isTurnRunning = false
    try {
      await readUsage($)
      await readBreakdown($).catch(() => {})
      const now = await $.clock.now()
      const l = await read($, live)
      const usd = l.usd !== null && l.turnBase !== null ? Math.max(0, l.usd - l.turnBase) : 0
      const added = l.tokens !== null && turnStartTokens !== null ? Math.max(0, l.tokens - turnStartTokens) : 0
      const turn: Turn = {
        at: now, ms: e.durationMs, added, usd,
        cached: turnInput ? turnRead / turnInput : 1,
        agentShare: usd > 0 ? Math.min(1, turnAgentUsd / usd) : 0,
        isCold: turnCold,
      }
      await update($, live, x => ({ ...x, turns: [...x.turns, turn].slice(-KEEP_TURNS), adds: [...x.adds, added].slice(-12) }))

      // The ledger line, when turned on: a dim transcript row, never sent to the model.
      if (s.telemetry && usd >= 0.01) {
        const bits = [seconds(e.durationMs), added ? '+' + tok(added) + ' payload' : '', money(usd), `${Math.round(turn.cached * 100)}% from cache`]
        if (turn.agentShare >= 0.2) bits.push(`subagents ${Math.round(turn.agentShare * 100)}%`)
        if (turn.isCold) bits.push('cold orbit')
        $.ui.log('◆ Telemetry · ' + bits.filter(Boolean).join(' · '))
      }

      // Budget: said once per session.
      const after = await read($, live)
      if (s.budget > 0 && after.usd !== null && !after.budgetWarned) {
        if (after.usd >= s.budget) {
          await update($, live, x => ({ ...x, budgetWarned: true }))
          $.ui.toast(`Mission Control: mission budget passed, this session is at ${money(after.usd)}`)
        }
      }
      const top = movesOf(after, now, s)[0]
      if (top && top.tone === 'hot' && top.id !== 'budget') await toastOnce($, `Mission Control: ${top.title.toLowerCase()} · ${tipOf(top)}`)
    } catch {
      // No reading this turn: the strip keeps the last one.
    }
    await light($, fuse, fuseFor($)).catch(() => {})
    $.ui.invalidate('ui.render')
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, live, x => ({
      ...x,
      limits: e.changed.includes('rateLimits') && e.rateLimits.length ? [...e.rateLimits] : x.limits,
      usd: e.cost?.usd ?? x.usd,
      tokens: e.context.tokens ?? x.tokens,
      window: effectiveWindow ?? (e.context.window || x.window),
    }))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.trigger === 'precompute' || !result.messages) return result
    try {
      await update($, live, x => ({
        ...x,
        tokens: result.tokensAfter && x.fixed !== null ? x.fixed + result.tokensAfter : x.tokens,
        conversation: result.tokensAfter ?? x.conversation,
        adds: [...x.adds, 0].slice(-12),
        // The next message writes the new, smaller context.
        cacheAt: null,
      }))
      for (const delay of [800, 2500]) void $.clock.after(delay, () => void readBreakdown($).catch(() => {}))
    } catch {
      // The compaction stands whatever the strip makes of it.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    defuse($, fuse)
    if (e.reason === 'clear') {
      await update($, live, x => ({ ...EMPTY, limits: x.limits, mcp: x.mcp }))
      turnStartTokens = null
    }
    if (e.reason === 'prompt_input_exit' || e.reason === 'other') ticker?.cancel()
    return result
  })

  // ---------- Drawing ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const el = $.ui.resolve(e)
    const l = await read($, live)
    const now = await $.clock.now()
    const strip = drawStrip(el, {
      live: l,
      week: await read($, week),
      move: movesOf(l, now, s)[0],
      now,
      columns: Math.max(20, e.props.bodyColumns),
      desktop: e.surface === 'desktop',
      onMove: () => void compactFromStrip($, fuseFor($)),
      onOpen: () => void togglePane($),
    })
    const below = await next(e)
    if (!strip) return below
    return below ? el.Box({ flexDirection: 'column', children: [strip, below] }) : strip
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const l = await read($, live)
    const now = await $.clock.now()
    return drawPane($.ui.resolve(e), {
      tab: await read($, tab),
      live: l,
      moves: movesOf(l, now, s),
      categories: await read($, categories),
      week: await read($, week),
      weekBusy: await read($, weekBusy),
      columns: e.props.bodyColumns,
      now,
      desktop: e.surface === 'desktop',
    }, {
      setTab: t => {
        void update($, tab, () => t)
        if (t === 'week') void readWeek($)
        if (t === 'tank') void readBreakdown($).catch(() => {})
      },
      compact: () => void compactFromStrip($, fuseFor($)),
      readWeek: () => void readWeek($, true),
    })
  })

  // A weight under heavy outputs and every subagent run.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const below = await next(e)
    const w = (await read($, live)).weights.find(x => x.id === e.props.tool_use_id)
    if (!w || !below) return below
    const { Box, Text } = $.ui.resolve(e)
    const text = w.isAgent
      ? `◆ Probe (subagent) · ${tok(w.tokens)} tokens${w.ms ? ' · ' + seconds(w.ms) : ''}${w.usd ? ' · ≈ ' + money(w.usd) : ''}${w.model ? ' · ' + w.model.replace(/^claude-/, '') : ''}`
      : `◆ Heavy cargo · ${tok(w.tokens)} now on board: every later request re-reads it`
    return Box({ flexDirection: 'column', children: [below, Text({ key: 'w', color: w.isAgent ? '#b866e6' : '#e0a030', children: text })] })
  })

  // The best move as the empty prompt's hint.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.props.isDraft || e.props.isWorking) return next(e)
    const l = await read($, live)
    const tip = tipOf(movesOf(l, await $.clock.now(), s)[0])
    return tip ? next({ ...e, props: { ...e.props, hint: tip } }) : next(e)
  })
}
