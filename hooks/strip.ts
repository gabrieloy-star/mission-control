// The strip above the prompt: context, prompt cache, usage limits, session cost, the suggestion
// and two buttons: insights and the full pane.
// Pure drawing. It measures every part in cells and keeps the most important ones that fit
// `bodyColumns`, so it is always one line. Desktop draws the gauges as small SVGs; the
// terminal draws them with glyphs.

import type { Limit, Live, Week } from '../types'
import { HEAVY_AT, HOUR, cacheEnd, cacheLeft, cacheWarnAt, clockOf, contextTone, markOf, money, savingOf, span, tok, ttlOf, whenOf } from './suggestions'
import type { Suggestion } from './suggestions'
import { sumTokens, tokensUsd } from './prices'
import { paceOf, paceWords, tasksOf } from './signals'

export const INK = {
  cobalt: '#5b8def',
  amber: '#e0a030',
  coral: '#e5534b',
  mint: '#3fb68b',
  orchid: '#b866e6',
  grey: '#8a93a6',
}
const TERM: Record<string, string> = { calm: 'green', warn: 'yellow', hot: 'red' }
const TONE: Record<string, string> = { calm: INK.mint, warn: INK.amber, hot: INK.coral }
/** One word and one symbol per state, so a state reads without its color. */
export const WORD: Record<string, string> = { calm: 'ALL GOOD', warn: 'WATCH', hot: 'ACT NOW' }
export const MARK: Record<string, string> = { calm: '✓', warn: '◆', hot: '▲' }
type Tone = 'calm' | 'warn' | 'hot'

/** Every tooltip reads the same way: the part and its state, what it is, then what to do. */
export function tipText(t: { name: string; now: string; tone: Tone; what: string[]; todo: string }): string {
  return [`${MARK[t.tone]} ${t.name} · ${t.now} · ${WORD[t.tone]}`, ...t.what.filter(Boolean), 'To do: ' + t.todo].join('\n')
}

/** Desktop gauges are sized as if a cell were this many CSS pixels wide. */
const PX_PER_CELL = 7.5
const GAP = 2

/** One line of a hover card: a dim label and a bold value, or a plain dim note. */
type CardRow = { label: string; value?: string; color?: string }
type Card = { title: string; rows: CardRow[]; isRight?: boolean }
type Part = { key: string; rank: number; cells: number; draw: () => unknown[]; tip?: string; card?: Card }

export type StripInput = {
  live: Live
  /** The last 7 days, when History has read them: the details card's Fable line. */
  week: Week | null
  suggestion: Suggestion | undefined
  /** How many insights are open: the count on the insights button. */
  insights: number
  now: number
  columns: number
  desktop: boolean
  onSuggestion: () => void
  /** A compaction is queued: the button says so until it runs. */
  isQueued?: boolean
  /** When idle compact runs if you send nothing first; null when it will not. */
  idleAt?: number | null
  onOpen: () => void
  onInsights: () => void
  /** First session after install: a short welcome above the strip until "got it". */
  isWelcome?: boolean
  onWelcomeDone?: () => void
  /** Tokens of context past which compacting is suggested: where the red line sits. */
  ceiling?: number
}

// ---------- Gauges ----------

/** The context gauge's scale: the window; the mark at the ceiling, or 85% of the window. */
function contextScale(live: Live, ceiling: number | undefined) {
  return { scale: live.window || HEAVY_AT, notch: markOf(live.window, ceiling).share }
}

function contextCells(live: Live, cells: number, ceiling: number | undefined) {
  const { scale, notch } = contextScale(live, ceiling)
  const tokens = Math.min(live.tokens ?? 0, scale)
  const fixed = Math.min(live.fixed ?? 0, tokens)
  const add = Math.min(live.adds[live.adds.length - 1] ?? 0, tokens - fixed)
  const f = Math.round((fixed / scale) * cells)
  const used = Math.max(f, Math.round((tokens / scale) * cells))
  const fresh = add > 0 ? Math.max(1, Math.round((add / scale) * cells)) : 0
  return { f, used, fresh: Math.min(fresh, used - f), notchAt: Math.round(notch * cells) }
}

function contextSvg(live: Live, ceiling: number | undefined): string {
  const n = 24, w = 3, g = 1, h = 12
  const c = contextCells(live, n, ceiling)
  let rects = ''
  for (let i = 0; i < n; i++) {
    const fill = i < c.f ? INK.grey : i < c.used ? INK.cobalt : INK.grey
    const opacity = i < c.f ? 0.9 : i < c.used - c.fresh ? 0.6 : i < c.used ? 1 : 0.22
    rects += `<rect x="${i * (w + g)}" y="1" width="${w}" height="${h - 2}" rx="0.8" fill="${fill}" opacity="${opacity}"/>`
  }
  const nx = c.notchAt * (w + g) - 0.75
  rects += `<rect x="${nx}" y="0" width="1.5" height="${h}" fill="${INK.coral}"/>`
  const width = n * (w + g) - g
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${rects}</svg>`
}

function cacheState(left: number, warn: number) {
  return left <= 0 ? 'hot' : left < warn ? 'warn' : 'calm'
}

/** `lead`: idle compact runs this long before the cache expires; a small tick marks the spot. */
function cacheSvg(left: number, ttl: number, warn: number, lead: number | null = null): string {
  const W = 52, H = 12
  const color = TONE[cacheState(left, warn)]!
  const x = Math.max(4, Math.min(1, left / ttl) * (W - 8) + 4)
  const burnt = `<line x1="${x}" y1="6" x2="${W - 1}" y2="6" stroke="${INK.grey}" stroke-width="1.2" stroke-dasharray="1.5 2.5" opacity="0.7"/>`
  if (left <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${burnt}<path d="M1.5 2 L8.5 10 M8.5 2 L1.5 10" stroke="${INK.coral}" stroke-width="1.8" stroke-linecap="round"/></svg>`
  }
  const rope = `<path d="M1 6 C ${x * 0.35} 2.5, ${x * 0.65} 9.5, ${x} 6" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
  const spark = `<circle cx="${x}" cy="6" r="4.5" fill="${color}" opacity="0.25"/><circle cx="${x}" cy="6" r="2.2" fill="${color}"/>`
  const tick = lead !== null && lead > 0 && lead < left
    ? `<line x1="${(lead / ttl) * (W - 8) + 4}" y1="1.5" x2="${(lead / ttl) * (W - 8) + 4}" y2="10.5" stroke="${INK.cobalt}" stroke-width="1.6" stroke-linecap="round"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${burnt}${tick}${rope}${spark}</svg>`
}

const SPANS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export function limitOf(limit: Limit, now: number) {
  const total = SPANS[limit.kind]
  const reset = Date.parse(limit.resetsAt ?? '')
  const left = Number.isNaN(reset) ? null : reset - now
  const clock = total && left !== null ? Math.max(0, Math.min(100, ((total - left) / total) * 100)) : null
  const used = Math.max(0, Math.min(100, limit.percentUsed))
  const ahead = clock === null ? 0 : used - clock
  const tone = used >= 85 || ahead > 15 ? 'hot' : ahead > 0 ? 'warn' : 'calm'
  return { label: LABELS[limit.kind] ?? limit.kind, used, clock, tone, left }
}

/** Usage left as the bar, time left in the window as the ring. */
function limitSvg(used: number, clock: number | null, tone: string): string {
  const W = 40, H = 10
  const xu = 3 + ((100 - used) / 100) * (W - 6)
  const color = TONE[tone]!
  const ring = clock === null ? '' : `<circle cx="${3 + ((100 - clock) / 100) * (W - 6)}" cy="5" r="3.3" fill="none" stroke="${INK.grey}" stroke-width="1.2"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<line x1="3" y1="5" x2="${W - 3}" y2="5" stroke="${INK.grey}" stroke-width="2" stroke-linecap="round" opacity="0.35"/>` +
    `<line x1="3" y1="5" x2="${xu}" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>${ring}` +
    `<circle cx="${xu}" cy="5" r="2.4" fill="${color}"/></svg>`
}

// ---------- The strip ----------

function cellsOf(px: number) {
  return Math.ceil(px / PX_PER_CELL)
}

export function drawStrip(el: any, s: StripInput): unknown | null {
  const { Box, Text, Button, Svg } = el
  const { live, now } = s
  if (live.tokens === null && live.usd === null) return null
  const desktop = s.desktop && !!Svg
  const parts: Part[] = []

  // Context
  if (live.tokens !== null) {
    const value = tok(live.tokens)
    const add = live.adds[live.adds.length - 1] ?? 0
    const addText = add > 0 ? '+' + tok(add) : ''
    const gauge = desktop ? cellsOf(96) : 13
    parts.push({
      key: 'context', rank: 1, cells: gauge + 1 + value.length + (addText ? 1 + addText.length : 0),
      tip: (() => {
        const pct = Math.round(((live.tokens ?? 0) / (live.window || 1)) * 100)
        const mark = markOf(live.window, s.ceiling)
        const tone: Tone = contextTone(live.tokens, live.window, s.ceiling)
        return tipText({
          name: 'Context', now: `${value} of ${tok(live.window)} (${pct}%)`, tone,
          what: [
            'Everything Claude sends with every message',
            live.fixed !== null ? `Grey: ${tok(live.fixed)} of instructions, tools and memory` : '',
            `Blue: your conversation · red line: ${mark.label}`,
            addText ? `${addText}: what your last message added (its reply, tool outputs and files read)` : '',
          ],
          todo: tone === 'hot' ? `compact (click compact): past ${mark.label} every message costs more and Claude can lose details`
            : tone === 'warn' ? 'type /clear before an unrelated task'
            : 'nothing',
        })
      })(),
      draw: () => {
        const out: unknown[] = []
        if (desktop) out.push(Svg({ key: 'g', source: contextSvg(live, s.ceiling), width: 95, height: 12, alt: `Context: ${value} of ${tok(live.window)}` }))
        else {
          const c = contextCells(live, 12, s.ceiling)
          const glyphs: unknown[] = []
          for (let i = 0; i < 12; i++) {
            if (i === c.notchAt) glyphs.push(Text({ key: 'n', color: INK.coral, children: '│' }))
            const isUsed = i < c.used
            const color = i < c.f ? INK.grey : isUsed ? INK.cobalt : undefined
            glyphs.push(Text({ key: 'c' + i, color, dimColor: !isUsed, bold: isUsed && i >= c.used - c.fresh && i >= c.f, children: isUsed ? '▰' : '▱' }))
          }
          out.push(Box({ key: 'g', flexDirection: 'row', children: glyphs }))
        }
        out.push(Text({ key: 'v', bold: true, children: value }))
        if (addText) out.push(Text({ key: 'a', dimColor: true, children: addText }))
        return out
      },
    })
  }

  // Prompt cache
  const left = cacheLeft(live, now)
  if (left !== null) {
    const ttl = ttlOf(live)
    const warn = cacheWarnAt(live)
    const state = cacheState(left, warn)
    const value = span(left)
    parts.push({
      key: 'cache', rank: 3, cells: (desktop ? cellsOf(52) : 7) + 1 + value.length,
      tip: tipText({
        name: 'Prompt cache', now: left > 0 ? `valid until ${clockOf(cacheEnd(live)!)}` : 'expired', tone: state as Tone,
        what: left > 0
          ? [`A ${ttl >= HOUR ? '1-hour' : '5-minute'} cache: while it lasts, each message reads the context at a fraction of the price`, 'After it expires, the next message pays full price to send it all again',
            s.idleAt && s.idleAt > now ? `If you send nothing, Usage Coach compacts at ${clockOf(s.idleAt)} (the blue tick)` : 'Idle compact: off for this session (small conversation or short cache)']
          : ['The next message pays full price to send the whole context again'],
        todo: state === 'hot' ? 'compact before your next message (click compact), or start a new session'
          : state === 'warn' ? `send your next message before ${clockOf(cacheEnd(live)!)}, or compact (click compact) before a break`
          : 'nothing',
      }),
      draw: () => {
        const out: unknown[] = []
        if (desktop) out.push(Svg({ key: 'g', source: cacheSvg(left, ttl, warn, s.idleAt ? cacheEnd(live)! - s.idleAt : null), width: 52, height: 12, alt: `Prompt cache: ${value} left` }))
        else {
          const r = left <= 0 ? 0 : Math.max(1, Math.min(6, Math.round((left / ttl) * 6)))
          const glyph = left <= 0 ? '✕' + '┄'.repeat(6) : '━'.repeat(r - 1) + '✦' + '┄'.repeat(7 - r)
          out.push(Text({ key: 'g', color: TERM[state], children: glyph }))
        }
        out.push(Text({ key: 'v', bold: true, color: state === 'calm' ? undefined : TONE[state], children: value }))
        return out
      },
    })
  }

  // Usage limits: 5 hours, then 7 days
  live.limits.forEach((limit, i) => {
    const r = limitOf(limit, now)
    if (r.left !== null && r.left <= 0) return
    const value = Math.max(0, 100 - Math.round(r.used)) + '%'
    const pace = paceOf(limit, live.limitSamples?.[limit.kind], now)
    const tone: Tone = pace?.isShort ? (pace.tone === 'hot' || r.tone === 'hot' ? 'hot' : 'warn') : r.tone as Tone
    parts.push({
      key: 'limit-' + limit.kind, rank: limit.kind === 'five_hour' ? 5 : 6 + i, cells: r.label.length + 1 + (desktop ? cellsOf(40) : 6) + 1 + value.length,
      tip: tipText({
        name: `${limit.kind === 'five_hour' ? '5-hour' : limit.kind === 'seven_day' ? 'Weekly' : r.label} usage limit`, now: `${value} left`, tone,
        what: [
          pace?.isShort ? `Runs out ${whenOf(pace.runsOutAt, now)} ${paceWords(pace)}: ${span(pace.resetsAt! - pace.runsOutAt)} before it resets` : '',
          r.clock !== null ? `Bar: usage left · ring: ${Math.max(0, 100 - Math.round(r.clock))}% of the time left` : '',
          'A bar behind the ring means you use it faster than time passes',
          r.left !== null ? `Resets in ${span(r.left)}` : '',
        ],
        todo: tone === 'calm' ? 'nothing' : 'run routine work on a lighter model (/model sonnet) and keep subagents for real searches',
      }),
      draw: () => {
        const out: unknown[] = [Text({ key: 'l', dimColor: true, children: r.label })]
        if (desktop) out.push(Svg({ key: 'g', source: limitSvg(r.used, r.clock, tone), width: 40, height: 10, alt: `Usage limit ${r.label}: ${value} left` }))
        else {
          const u = Math.round(((100 - r.used) / 100) * 6)
          const c = r.clock === null ? -1 : Math.min(5, Math.round(((100 - r.clock) / 100) * 6))
          let bar = ''
          for (let k = 0; k < 6; k++) bar += k < u ? '━' : k === c ? '○' : '─'
          out.push(Text({ key: 'g', color: TERM[tone], children: bar }))
        }
        out.push(Text({ key: 'v', bold: true, ...(tone === 'calm' ? {} : { color: TONE[tone] }), children: value }))
        return out
      },
    })
  })

  // Session cost
  if (live.usd !== null && live.usd >= 0.005) {
    const value = money(live.usd)
    const lastTurn = live.turns[live.turns.length - 1]
    const delta = lastTurn && lastTurn.usd >= 0.005 ? '+' + money(lastTurn.usd).replace(/^\$/, '') : ''
    parts.push({
      key: 'spend', rank: 4, cells: value.length + (delta ? 1 + delta.length : 0),
      tip: (() => {
        const task = tasksOf(live.turns).slice(-1)[0]
        return tipText({
          name: 'Session cost', now: value, tone: 'calm',
          what: [
            delta ? `Last message: +$${delta.replace(/^\+/, '')}` : '',
            task && task.messages > 1 ? `Last task: ${money(task.usd)} over ${task.messages} messages` : '',
            'At API list prices: on a subscription it is an equivalent, not a bill',
          ],
          todo: 'nothing · the Session tab shows the cost of each task',
        })
      })(),
      draw: () => [Text({ key: 'v', bold: true, children: value }), ...(delta ? [Text({ key: 'd', dimColor: true, children: delta })] : [])],
    })
  }

  // The suggestion
  const suggestion = s.suggestion
  const long = suggestion ? `${suggestion.short}${suggestion.usd > 0.01 ? ' · saves ' + money(suggestion.usd) + (suggestion.unit === 'now' ? '' : ' ' + suggestion.unit) : ''}` : 'all good'
  const short = suggestion ? `${suggestion.short}${suggestion.usd > 0.01 && suggestion.unit === 'now' ? ' ' + money(suggestion.usd) : ''}` : 'all good'
  const suggestionCells = (label: string) => label.length + (suggestion?.key ? 4 : 2)
  const drawSuggestion = (label: string) => () => {
    if (!suggestion) return [Text({ key: 'm', color: INK.mint, children: MARK.calm + ' ' + label })]
    if (suggestion.key && s.isQueued) return [Text({ key: 'm', color: INK.amber, children: MARK.warn + ' compaction queued' })]
    if (suggestion.key) return [Button({ key: 'suggestion', label, variant: 'primary', onPress: s.onSuggestion })]
    return [Text({ key: 'm', color: TONE[suggestion.tone], children: MARK[suggestion.tone] + ' ' + label })]
  }
  const suggestionTip = suggestion
    ? tipText({
      name: 'Suggestion', now: suggestion.title, tone: suggestion.tone,
      what: [savingOf(suggestion) ? 'Saves' + savingOf(suggestion).replace(' · saves', '') : ''],
      todo: suggestion.how,
    })
    : tipText({ name: 'Suggestion', now: 'none', tone: 'calm', what: ['No change would save $1 or more right now'], todo: 'nothing' })
  parts.push({ key: 'suggestion', rank: 2, cells: suggestionCells(long), draw: drawSuggestion(long), tip: suggestionTip })
  const insightLabel = s.insights ? `insights ${s.insights}` : 'insights'
  parts.push({
    key: 'insights', rank: 2.5, cells: insightLabel.length + 4,
    draw: () => [Button({ key: 'insights', label: insightLabel, plain: true, onPress: s.onInsights })],
    tip: tipText({
      name: 'Insights', now: s.insights ? `${s.insights} for this session` : 'none open', tone: 'calm',
      what: ['Your usage limits, whether the model fits the work, and habits that keep sessions cheap'],
      todo: 'click insights to read them',
    }),
  })
  parts.push({ key: 'open', rank: 1.5, cells: 11, draw: () => [Button({ key: 'open', label: 'details', onPress: s.onOpen })], card: statusCard(s) })

  // Fit: keep parts by rank while they fit; a long suggestion label gives way to the short one first.
  const fit = (list: Part[]) => {
    const kept: Part[] = []
    let used = 0
    for (const p of [...list].sort((a, b) => a.rank - b.rank)) {
      const need = p.cells + (kept.length ? GAP : 0)
      if (used + need <= s.columns) {
        kept.push(p)
        used += need
      }
    }
    return kept
  }
  let kept = fit(parts)
  if (!kept.some(p => p.key === 'suggestion') || kept.length < Math.min(parts.length, 4)) {
    const shorter = parts.map(p => (p.key === 'suggestion' ? { ...p, cells: suggestionCells(short), draw: drawSuggestion(short) } : p))
    kept = fit(shorter)
  }
  const order = ['context', 'cache', 'limit-five_hour', 'limit-seven_day', 'spend', 'suggestion', 'insights', 'open']
  kept.sort((a, b) => (order.indexOf(a.key) + 99) % 99 - (order.indexOf(b.key) + 99) % 99)

  const line = Box({
    key: 'strip',
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: GAP,
    children: kept.map(p => Box({
      key: p.key, flexDirection: 'row', alignItems: 'center', columnGap: 1, flexShrink: 0,
      children: !desktop ? p.draw()
        : p.card ? [...p.draw(), richCard(el, p.card)]
        : p.tip ? [...p.draw(), hoverCard(el, p.tip)]
        : p.draw(),
    })),
  })
  if (!s.isWelcome) return line
  const welcome = Box({
    key: 'welcome', flexDirection: 'column', borderStyle: 'round', borderColor: INK.cobalt, paddingX: 1,
    children: [
      Text({ key: 'a', bold: true, children: 'Usage Coach: this line shows your context, prompt cache, usage limits and session cost. It costs no tokens.' }),
      Text({ key: 'b', dimColor: true, children: desktop
        ? 'Hover any part to see what it means and what to do. The right end shows the change that saves the most.'
        : 'The right end shows the change that saves the most. Click insights for more.' }),
      Box({ key: 'c', flexDirection: 'row', columnGap: 2, alignItems: 'center', children: [
        Text({ key: 't', dimColor: true, children: 'Click details for the full panel.' }),
        Button({ key: 'ok', label: 'got it', variant: 'primary', onPress: s.onWelcomeDone ?? (() => {}) }),
      ] }),
    ],
  })
  return Box({ flexDirection: 'column', children: [welcome, line] })
}

/** Tokens and list-price dollars a model family spent in the week, main and subagents together. */
export function familyWeek(w: Week, family: string) {
  let tokens = 0, usd = 0
  for (const byModel of [w.main, w.sub]) {
    for (const [model, t] of Object.entries(byModel)) {
      if (!model.includes(family)) continue
      tokens += sumTokens(t)
      usd += tokensUsd(t, model)
    }
  }
  return { tokens, usd }
}

/** The details card: this session, both usage limits with their reset time, and the week's Fable use. */
export function statusCard(s: StripInput): Card {
  const { live, now } = s
  const rows: CardRow[] = []
  const model = live.model.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
  const elapsed = live.startedAt ? span(now - live.startedAt) : ''
  rows.push({ label: 'This session', value: [elapsed, model, live.usd !== null ? money(live.usd) : ''].filter(Boolean).join(' · ') })
  const names: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', spend_limit: 'Spend limit' }
  for (const limit of live.limits) {
    const r = limitOf(limit, now)
    const left = Math.max(0, 100 - Math.round(r.used))
    const resets = r.left !== null && r.left > 0 ? ` · resets in ${span(r.left)}` : ''
    const pace = paceOf(limit, live.limitSamples?.[limit.kind], now)
    const tone = pace?.isShort ? (pace.tone === 'hot' ? 'hot' : 'warn') : r.tone
    rows.push({ label: names[limit.kind] ?? limit.kind, value: `${left}% left${resets}`, color: tone === 'calm' ? undefined : TONE[tone] })
    if (pace?.isShort) rows.push({ label: '   runs out', value: `${whenOf(pace.runsOutAt, now)} · ${span(pace.resetsAt! - pace.runsOutAt)} early`, color: TONE[tone] })
  }
  if (!live.limits.length) rows.push({ label: 'Usage limits: Claude reports them after the next message' })
  if (s.week) {
    const fable = familyWeek(s.week, 'fable')
    rows.push({ label: 'Fable · 7 days', value: fable.tokens ? `${tok(fable.tokens)} · ≈ ${money(fable.usd)}` : 'not used' })
  } else {
    rows.push({ label: 'Fable · 7 days: reading the week…' })
  }
  rows.push({ label: 'Click details to open the Usage Coach panel' })
  return { title: 'Session status', rows, isRight: true }
}

function richCard(el: any, card: Card) {
  const { Box, Text } = el
  return Box({
    position: 'absolute',
    bottom: 1,
    ...(card.isRight ? { right: 0 } : { left: 0 }),
    display: 'none',
    hover: { display: 'flex' },
    flexDirection: 'column',
    paddingX: 1,
    borderStyle: 'round',
    borderColor: 'subtle',
    backgroundColor: 'background',
    children: [
      Text({ key: 'h', bold: true, children: card.title }),
      ...card.rows.map((r, i) => r.value === undefined
        ? Text({ key: 'r' + i, dimColor: true, children: r.label })
        : Box({ key: 'r' + i, flexDirection: 'row', justifyContent: 'space-between', columnGap: 3, children: [
          Text({ key: 'l', dimColor: true, children: r.label }),
          Text({ key: 'v', bold: true, ...(r.color ? { color: r.color } : {}), children: r.value }),
        ] })),
    ],
  })
}

/** A card over the strip while the pointer rests on a part (desktop; the terminal has no hover). */
function hoverCard(el: any, tip: string) {
  const { Box, Text } = el
  return Box({
    position: 'absolute',
    bottom: 1,
    left: 0,
    display: 'none',
    hover: { display: 'flex' },
    flexDirection: 'column',
    paddingX: 1,
    borderStyle: 'round',
    borderColor: 'subtle',
    backgroundColor: 'background',
    children: tip.split('\n').map((line, i) => Text({ key: 't' + i, dimColor: i > 0 && !line.startsWith('To do:'), bold: i === 0, children: line })),
  })
}
