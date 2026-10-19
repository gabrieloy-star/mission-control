// The strip above the prompt: payload, orbit, fuel, mission cost, and the next maneuver.
// Pure drawing. It measures every part in cells and keeps the most important ones that fit
// `bodyColumns`, so it is always one line. Desktop draws the gauges as small SVGs; the
// terminal draws them with glyphs.

import type { Limit, Live, Week } from '../types'
import { FUSE_WARN, HEAVY_AT, HOUR, clockOf, fuseLeft, money, span, tok } from './moves'
import type { Move } from './moves'
import { sumTokens, tokensUsd } from './prices'

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

/** Desktop gauges are sized as if a cell were this many CSS pixels wide. */
const PX_PER_CELL = 7.5
const GAP = 2

/** One line of a hover card: a dim label and a bold value, or a plain dim note. */
type CardRow = { label: string; value?: string; color?: string }
type Card = { title: string; rows: CardRow[]; isRight?: boolean }
type Part = { key: string; rank: number; cells: number; draw: () => unknown[]; tip?: string; card?: Card }

export type StripInput = {
  live: Live
  /** The last 7 days, when History has read them: the ⋯ card's Fable line. */
  week: Week | null
  move: Move | undefined
  now: number
  columns: number
  desktop: boolean
  onMove: () => void
  onOpen: () => void
}

// ---------- Gauges ----------

/** The tank's scale: the window compaction is measured against; the notch at 85% of it. */
function tankScale(live: Live) {
  return { scale: live.window || HEAVY_AT, notch: 0.85 }
}

function tankCells(live: Live, cells: number) {
  const { scale, notch } = tankScale(live)
  const tokens = Math.min(live.tokens ?? 0, scale)
  const fixed = Math.min(live.fixed ?? 0, tokens)
  const add = Math.min(live.adds[live.adds.length - 1] ?? 0, tokens - fixed)
  const f = Math.round((fixed / scale) * cells)
  const used = Math.max(f, Math.round((tokens / scale) * cells))
  const fresh = add > 0 ? Math.max(1, Math.round((add / scale) * cells)) : 0
  return { f, used, fresh: Math.min(fresh, used - f), notchAt: Math.round(notch * cells) }
}

function tankSvg(live: Live): string {
  const n = 24, w = 3, g = 1, h = 12
  const c = tankCells(live, n)
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

function fuseState(left: number) {
  return left <= 0 ? 'hot' : left < FUSE_WARN ? 'warn' : 'calm'
}

function fuseSvg(left: number): string {
  const W = 52, H = 12
  const color = TONE[fuseState(left)]!
  const x = Math.max(4, Math.min(1, left / HOUR) * (W - 8) + 4)
  const burnt = `<line x1="${x}" y1="6" x2="${W - 1}" y2="6" stroke="${INK.grey}" stroke-width="1.2" stroke-dasharray="1.5 2.5" opacity="0.7"/>`
  if (left <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${burnt}<path d="M1.5 2 L8.5 10 M8.5 2 L1.5 10" stroke="${INK.coral}" stroke-width="1.8" stroke-linecap="round"/></svg>`
  }
  const rope = `<path d="M1 6 C ${x * 0.35} 2.5, ${x * 0.65} 9.5, ${x} 6" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
  const spark = `<circle cx="${x}" cy="6" r="4.5" fill="${color}" opacity="0.25"/><circle cx="${x}" cy="6" r="2.2" fill="${color}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${burnt}${rope}${spark}</svg>`
}

const SPANS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export function raceOf(limit: Limit, now: number) {
  const total = SPANS[limit.kind]
  const reset = Date.parse(limit.resetsAt ?? '')
  const left = Number.isNaN(reset) ? null : reset - now
  const clock = total && left !== null ? Math.max(0, Math.min(100, ((total - left) / total) * 100)) : null
  const used = Math.max(0, Math.min(100, limit.percentUsed))
  const ahead = clock === null ? 0 : used - clock
  const tone = used >= 85 || ahead > 15 ? 'hot' : ahead > 0 ? 'warn' : 'calm'
  return { label: LABELS[limit.kind] ?? limit.kind, used, clock, tone, left }
}

/** Fuel left as the bar, time left in the window as the ring. */
function raceSvg(used: number, clock: number | null, tone: string): string {
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

  // Tank
  if (live.tokens !== null) {
    const value = tok(live.tokens)
    const add = live.adds[live.adds.length - 1] ?? 0
    const addText = add > 0 ? '+' + tok(add) : ''
    const gauge = desktop ? cellsOf(96) : 13
    parts.push({
      key: 'tank', rank: 1, cells: gauge + 1 + value.length + (addText ? 1 + addText.length : 0),
      tip: [
        `Payload: ${value} of ${tok(live.window)} on board (${Math.round(((live.tokens ?? 0) / (live.window || 1)) * 100)}%)`,
        'Everything Claude re-reads on every request: the context',
        live.fixed !== null ? `Grey: ${tok(live.fixed)} of instructions, tools and memory` : '',
        'Blue: your conversation · bright: what the last message added',
        'Red line at 85%: past it, compacting pays off',
      ].filter(Boolean).join('\n'),
      draw: () => {
        const out: unknown[] = []
        if (desktop) out.push(Svg({ key: 'g', source: tankSvg(live), width: 95, height: 12, alt: `Context: ${value} of ${tok(live.window)}` }))
        else {
          const c = tankCells(live, 12)
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

  // Fuse
  const left = fuseLeft(live, now)
  if (left !== null) {
    const state = fuseState(left)
    const value = span(left)
    parts.push({
      key: 'fuse', rank: 3, cells: (desktop ? cellsOf(52) : 7) + 1 + value.length,
      tip: left > 0
        ? `Orbit: the prompt cache stays warm until ${clockOf(live.cacheAt! + HOUR)}\nIn orbit, each message re-reads the payload at a fraction of the price\nIf it decays, the next message pays to write everything again`
        : 'Orbit decayed: the prompt cache is cold\nThe next message pays to write the whole payload again\nCompact first, or launch a fresh thread',
      draw: () => {
        const out: unknown[] = []
        if (desktop) out.push(Svg({ key: 'g', source: fuseSvg(left), width: 52, height: 12, alt: `Prompt cache: ${value} left` }))
        else {
          const r = left <= 0 ? 0 : Math.max(1, Math.round((left / HOUR) * 6))
          const glyph = left <= 0 ? '✕' + '┄'.repeat(6) : '━'.repeat(r - 1) + '✦' + '┄'.repeat(7 - r)
          out.push(Text({ key: 'g', color: TERM[state], children: glyph }))
        }
        out.push(Text({ key: 'v', bold: true, color: state === 'calm' ? undefined : TONE[state], children: value }))
        return out
      },
    })
  }

  // Race: 5h, then 7d
  live.limits.forEach((limit, i) => {
    const r = raceOf(limit, now)
    if (r.left !== null && r.left <= 0) return
    const value = Math.max(0, 100 - Math.round(r.used)) + '%'
    parts.push({
      key: 'race-' + limit.kind, rank: limit.kind === 'five_hour' ? 5 : 6 + i, cells: r.label.length + 1 + (desktop ? cellsOf(40) : 6) + 1 + value.length,
      tip: [
        `Fuel ${limit.kind === 'five_hour' ? '5-hour' : limit.kind === 'seven_day' ? '7-day' : r.label}: ${value} of your usage limit left`,
        r.clock !== null ? `Ring: ${Math.max(0, 100 - Math.round(r.clock))}% of the time window left` : '',
        'Fuel below the ring: you are burning faster than the clock',
        r.left !== null ? `Refuels in ${span(r.left)}` : '',
      ].filter(Boolean).join('\n'),
      draw: () => {
        const out: unknown[] = [Text({ key: 'l', dimColor: true, children: r.label })]
        if (desktop) out.push(Svg({ key: 'g', source: raceSvg(r.used, r.clock, r.tone), width: 40, height: 10, alt: `Fuel ${r.label}: ${value} left` }))
        else {
          const u = Math.round(((100 - r.used) / 100) * 6)
          const c = r.clock === null ? -1 : Math.min(5, Math.round(((100 - r.clock) / 100) * 6))
          let bar = ''
          for (let k = 0; k < 6; k++) bar += k < u ? '━' : k === c ? '○' : '─'
          out.push(Text({ key: 'g', color: TERM[r.tone], children: bar }))
        }
        out.push(Text({ key: 'v', bold: true, children: value }))
        return out
      },
    })
  })

  // Spend
  if (live.usd !== null && live.usd >= 0.005) {
    const value = money(live.usd)
    const lastTurn = live.turns[live.turns.length - 1]
    const delta = lastTurn && lastTurn.usd >= 0.005 ? '+' + money(lastTurn.usd).replace(/^\$|^R\$ /, '') : ''
    parts.push({
      key: 'spend', rank: 4, cells: value.length + (delta ? 1 + delta.length : 0),
      tip: `Mission cost so far: ${value}${delta ? '\nLast message: +' + delta.replace(/^\+/, '') : ''}\nAt list prices: on a subscription it is an equivalent, not a bill`,
      draw: () => [Text({ key: 'v', bold: true, children: value }), ...(delta ? [Text({ key: 'd', dimColor: true, children: delta })] : [])],
    })
  }

  // The move
  const move = s.move
  const long = move ? `${move.short}${move.usd > 0.01 ? ' · saves ≈ ' + money(move.usd) + (move.unit === 'now' ? '' : ' ' + move.unit) : ''}` : 'nominal'
  const short = move ? `${move.short}${move.usd > 0.01 && move.unit === 'now' ? ' ' + money(move.usd) : ''}` : 'nominal'
  const moveCells = (label: string) => label.length + (move?.key ? 7 : 2)
  const drawMove = (label: string) => () => {
    if (!move) return [Text({ key: 'm', color: INK.mint, children: '✓ ' + label })]
    if (move.key) return [Button({ key: 'move', label, hotkey: move.key, variant: 'primary', onPress: s.onMove })]
    return [Text({ key: 'm', color: TONE[move.tone], children: '◆ ' + label })]
  }
  const moveTip = move ? `Next maneuver: ${move.title}\n${move.how}` : 'All systems nominal\nPayload, orbit and fuel are steady: nothing to change'
  parts.push({ key: 'move', rank: 2, cells: moveCells(long), draw: drawMove(long), tip: moveTip })
  parts.push({ key: 'open', rank: 1.5, cells: 5, draw: () => [Button({ key: 'open', label: '⋯', hotkey: 'o', onPress: s.onOpen })], card: statusCard(s) })

  // Fit: keep parts by rank while they fit; a long move label gives way to the short one first.
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
  if (!kept.some(p => p.key === 'move') || kept.length < Math.min(parts.length, 4)) {
    const shorter = parts.map(p => (p.key === 'move' ? { ...p, cells: moveCells(short), draw: drawMove(short) } : p))
    kept = fit(shorter)
  }
  const order = ['tank', 'fuse', 'race-five_hour', 'race-seven_day', 'spend', 'move', 'open']
  kept.sort((a, b) => (order.indexOf(a.key) + 99) % 99 - (order.indexOf(b.key) + 99) % 99)

  return Box({
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

/** The ⋯ card: this flight, both fuel windows with their refuel time, and the week's Fable use. */
export function statusCard(s: StripInput): Card {
  const { live, now } = s
  const rows: CardRow[] = []
  const model = live.model.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
  const elapsed = live.startedAt ? span(now - live.startedAt) : ''
  rows.push({ label: 'This session', value: [elapsed, model, live.usd !== null ? money(live.usd) : ''].filter(Boolean).join(' · ') })
  const names: Record<string, string> = { five_hour: 'Fuel · 5 hours', seven_day: 'Fuel · 7 days', spend_limit: 'Spend limit' }
  for (const limit of live.limits) {
    const r = raceOf(limit, now)
    const left = Math.max(0, 100 - Math.round(r.used))
    const refuel = r.left !== null && r.left > 0 ? ` · refuels in ${span(r.left)}` : ''
    rows.push({ label: names[limit.kind] ?? limit.kind, value: `${left}% left${refuel}`, color: r.tone === 'calm' ? undefined : TONE[r.tone] })
  }
  if (!live.limits.length) rows.push({ label: 'Fuel: Claude reports your limits after the next message' })
  if (s.week) {
    const fable = familyWeek(s.week, 'fable')
    rows.push({ label: 'Fable · 7 days', value: fable.tokens ? `${tok(fable.tokens)} · ≈ ${money(fable.usd)}` : 'not used' })
  } else {
    rows.push({ label: 'Fable · 7 days: reading the week…' })
  }
  rows.push({ label: 'Press O for the full Mission Control' })
  return { title: 'Mission status', rows, isRight: true }
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
    children: tip.split('\n').map((line, i) => Text({ key: 't' + i, dimColor: i > 0, bold: i === 0, children: line })),
  })
}
