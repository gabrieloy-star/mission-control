// The Usage Coach pane: a status line, then Suggestions (what to do), Context (what every
// message sends), Session (this session, message by message), History (the last 7 days) and
// Insights (model fit and good habits).
// Pure drawing. Each tab opens on a row of readout tiles. The desktop draws its bars and charts
// as SVG; the terminal draws the same in glyphs.

import type { Category, Live, Tab, Week } from '../types'
import { cacheLeft, cacheWarnAt, clockOf, money, seconds, span, tok } from './suggestions'
import type { Suggestion } from './suggestions'
import { INK, MARK, limitOf } from './strip'
import { paceOf, tasksOf, trendOf } from './signals'
import { readUsd } from './prices'
import { summarize } from './week'
import { HABITS, modelName } from './insights'
import type { Insight } from './insights'

export type PaneInput = {
  tab: Tab
  live: Live
  suggestions: Suggestion[]
  insights: Insight[]
  categories: Category[]
  week: Week | null
  weekBusy: boolean
  columns: number
  now: number
  desktop: boolean
  /** What the strip's compactions saved over 7 days. */
  saved?: { usd: number; count: number }
  /** Today's cost across sessions; null until History has read them. */
  today?: number | null
}

export type PaneActions = {
  setTab: (tab: Tab) => void
  compact: () => void
  readWeek: () => void
}

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'suggestions', label: 'Suggestions', hotkey: '1' },
  { tab: 'context', label: 'Context', hotkey: '2' },
  { tab: 'session', label: 'Session', hotkey: '3' },
  { tab: 'week', label: 'History', hotkey: '4' },
  { tab: 'insights', label: 'Insights', hotkey: '5' },
]
const TONE: Record<string, string> = { calm: INK.mint, warn: INK.amber, hot: INK.coral }
/** CSS pixels per column in the desktop pane, measured on screen. */
const PX = 7.85
const SPARK = '▁▂▃▄▅▆▇█'
const SANS = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
const FAINT = '#8a93a6'

/** Claude's own category names, as /context shows them. */
const SHADES: Record<string, string> = {
  'Messages': INK.cobalt,
  'System prompt': '#6b7488',
  'System tools': '#9aa3b5',
  'MCP tools': INK.orchid,
  'Memory files': INK.mint,
  'Skills': INK.amber,
  'Custom agents': '#c7cbd6',
}

type Tile = { label: string; value: string; color?: string }

/** Text inside an SVG: "<" and "&" would break the whole picture (as in "< $0.01"). */
function esc(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svg(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${SANS}">${body}</svg>`
}

/** A rounded meter: a faint track and a filled share of it. */
function meterSvg(w: number, h: number, share: number, color: string) {
  const fill = Math.max(share > 0 ? h : 0, Math.min(1, share) * w)
  return svg(w, h, `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${FAINT}" opacity="0.16"/><rect width="${fill.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>`)
}

function glyphMeter(share: number, cells: number) {
  const n = Math.max(share > 0 ? 1 : 0, Math.round(Math.min(1, share) * cells))
  return '━'.repeat(n) + '╌'.repeat(Math.max(0, cells - n))
}

export function statusOf(suggestions: Suggestion[]) {
  const top = suggestions[0]
  if (!top || top.tone === 'calm') return { word: 'ALL GOOD', color: INK.mint, mark: MARK.calm }
  return top.tone === 'warn' ? { word: 'SUGGESTION', color: INK.amber, mark: MARK.warn } : { word: 'ACT NOW', color: INK.coral, mark: MARK.hot }
}

export function drawPane(el: any, p: PaneInput, act: PaneActions) {
  const { Box, Text, Button, Svg } = el
  const desktop = p.desktop && !!Svg
  const cols = Math.max(30, p.columns)
  const W = Math.floor(cols * PX) - 2
  const live = p.live

  // ---------- Pieces ----------
  const gap = (key: string) => Text({ key, children: ' ' })
  const divider = (key: string) => desktop
    ? Svg({ key, alt: '', width: W, height: 9, source: svg(W, 9, `<line x1="0" y1="4.5" x2="${W}" y2="4.5" stroke="${FAINT}" stroke-opacity="0.3"/>`) })
    : Text({ key, dimColor: true, children: '─'.repeat(cols - 1) })
  const caption = (key: string, text: string, note?: string) => Box({ key, flexDirection: 'row', justifyContent: 'space-between', marginTop: 1, children: [
    Text({ key: 'c', bold: true, dimColor: true, children: text.toUpperCase() }),
    ...(note ? [Text({ key: 'n', dimColor: true, children: note })] : []),
  ] })
  const row = (key: string, label: string, value: string, color?: string) =>
    Box({ key, flexDirection: 'row', justifyContent: 'space-between', columnGap: 2, children: [
      Text({ key: 'l', wrap: 'truncate-end', children: label }),
      Text({ key: 'v', bold: true, ...(color ? { color } : {}), children: value }),
    ] })
  const tiles = (key: string, list: Tile[]) => Box({ key, flexDirection: 'row', columnGap: 1, children: list.map((t, i) => Box({
    key: 't' + i, flexDirection: 'column', flexGrow: 1, flexShrink: 1, borderStyle: 'round', borderColor: FAINT, borderDimColor: true, paddingX: 1,
    children: [
      Text({ key: 'l', dimColor: true, wrap: 'truncate-end', children: t.label }),
      Text({ key: 'v', bold: true, ...(t.color ? { color: t.color } : {}), wrap: 'truncate-end', children: t.value }),
    ],
  })) })
  const legend = (key: string, color: string, label: string, note: string) => Box({ key, flexDirection: 'row', columnGap: 1, alignItems: 'flex-start', children: [
    Text({ key: 'sw', color, children: '●' }),
    Box({ key: 'tx', flexDirection: 'column', flexShrink: 1, children: [
      Text({ key: 'l', bold: true, children: label }),
      Text({ key: 'n', dimColor: true, children: note }),
    ] }),
  ] })
  /** A labelled bar: name, meter, value. The meter is SVG on the desktop. */
  const barRow = (key: string, label: string, share: number, value: string, color: string) => {
    const mw = desktop ? Math.max(70, Math.round(W * 0.34)) : Math.max(8, Math.round(cols * 0.3))
    return Box({ key, flexDirection: 'row', alignItems: 'center', columnGap: 2, children: [
      Box({ key: 'l', flexGrow: 1, flexShrink: 1, children: [Text({ key: 't', wrap: 'truncate-end', children: label })] }),
      desktop
        ? Svg({ key: 'm', alt: '', width: mw, height: 8, source: meterSvg(mw, 8, share, color) })
        : Text({ key: 'm', color, children: glyphMeter(share, mw) }),
      Box({ key: 'v', width: 7, justifyContent: 'flex-end', children: [Text({ key: 't', dimColor: true, children: value })] }),
    ] })
  }
  const note = (key: string, text: string, color = INK.amber) => Box({ key, flexDirection: 'row', columnGap: 1, alignItems: 'flex-start', marginTop: 1, children: [
    Text({ key: 'd', color, children: '◆' }),
    Box({ key: 't', flexShrink: 1, children: [Text({ key: 't', children: text })] }),
  ] })

  // ---------- Status line ----------
  const status = statusOf(p.suggestions)
  const elapsed = live.startedAt ? span(p.now - live.startedAt) : ''
  const model = live.model ? modelName(live.model) : ''
  const head = Box({ key: 'head', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', children: [
    Box({ key: 'l', flexDirection: 'row', columnGap: 1, children: [
      Text({ key: 's', bold: true, color: status.color, children: status.mark + ' ' + status.word }),
      Text({ key: 'm', dimColor: true, children: [elapsed, model].filter(Boolean).join(' · ') }),
    ] }),
    Text({ key: 'c', bold: true, children: live.usd === null ? '–' : money(live.usd) }),
  ] })

  // ---------- Today: three numbers on every tab ----------
  const five = live.limits.find(l => l.kind === 'five_hour')
  const fiveTile: Tile = (() => {
    if (!five) return { label: '5-hour limit', value: '–' }
    const r = limitOf(five, p.now)
    const left = `${Math.max(0, 100 - Math.round(r.used))}% left`
    const pace = paceOf(five, live.limitSamples?.five_hour, p.now)
    if (pace?.isShort) return { label: '5-hour limit', value: `${left} · out ${clockOf(pace.runsOutAt)}`, color: pace.tone === 'hot' ? INK.coral : INK.amber }
    return { label: '5-hour limit', value: left, ...(r.tone === 'calm' ? {} : { color: TONE[r.tone] }) }
  })()
  const today = tiles('today', [
    { label: 'Today · all sessions', value: p.today === null || p.today === undefined ? '–' : money(p.today) },
    fiveTile,
    { label: 'Saved · 7 days', value: p.saved && p.saved.count ? money(p.saved.usd) : 'nothing yet', ...(p.saved && p.saved.usd >= 0.01 ? { color: INK.mint } : {}) },
  ])
  const todayNote = p.today === null || p.today === undefined
    ? [Text({ key: 'today-n', dimColor: true, children: 'Today appears once History has read your sessions (about 10 s, no tokens).' })]
    : []

  const tabs = Box({ key: 'tabs', flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: TABS.map(t =>
    Button({ key: 'tab-' + t.tab, label: t.label, hotkey: t.hotkey, ...(t.tab === p.tab ? { variant: 'primary' } : { plain: true }), onPress: () => act.setTab(t.tab) })) })

  let body: unknown[] = []

  // ---------- Suggestions ----------
  if (p.tab === 'suggestions') {
    if (p.suggestions.length === 0) {
      body = [
        ...(desktop ? [Svg({ key: 'check', alt: 'All good', width: W, height: 84, source: svg(W, 84,
          `<circle cx="${W / 2}" cy="42" r="28" fill="${INK.mint}" fill-opacity="0.12" stroke="${INK.mint}" stroke-opacity="0.6" stroke-width="1.5"/>` +
          `<path d="M ${W / 2 - 12} 43 l 8 8 l 16 -17" fill="none" stroke="${INK.mint}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`) })] : []),
        Text({ key: 'ok', bold: true, color: INK.mint, children: 'All good' }),
        Text({ key: 'why', dimColor: true, children: 'Nothing worth changing right now. A suggestion appears here when a change would save real money.' }),
      ]
    } else {
      const now = p.suggestions.filter(m => m.unit === 'now').reduce((n, m) => n + m.usd, 0)
      body = [
        tiles('k', [
          { label: 'Suggestions', value: String(p.suggestions.length), color: TONE[p.suggestions[0]!.tone] },
          { label: 'Save now', value: now > 0.01 ? money(now) : '–', color: now > 0.01 ? INK.mint : undefined },
          { label: 'Context', value: live.tokens === null ? '–' : tok(live.tokens) },
        ]),
        ...p.suggestions.map((m, i) => Box({
          key: 'm' + i, flexDirection: 'column', borderStyle: 'round', borderColor: TONE[m.tone], paddingX: 1, marginTop: 1,
          children: [
            Box({ key: 'h', flexDirection: 'row', justifyContent: 'space-between', columnGap: 2, children: [
              Box({ key: 't', flexShrink: 1, children: [Text({ key: 't', bold: true, color: TONE[m.tone], children: m.title })] }),
              ...(m.usd > 0.01 ? [Box({ key: 's', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, children: [
                Text({ key: 'v', bold: true, children: 'saves ' + money(m.usd) }),
                ...(m.unit === 'now' ? [] : [Text({ key: 'u', dimColor: true, children: m.unit })]),
              ] })] : []),
            ] }),
            Text({ key: 'w', dimColor: true, children: m.how }),
            ...(m.key === 'c' ? [Box({ key: 'do', marginTop: 1, marginBottom: 0, children: [Button({ key: 'do', label: 'Compact now', variant: 'primary', onPress: act.compact })] })] : []),
          ],
        })),
      ]
    }
  }

  // ---------- Context ----------
  if (p.tab === 'context') {
    const window = live.window || 1
    const cats = p.categories.map(c => ({ name: c.name, tokens: c.tokens }))
    const onBoard = live.tokens ?? cats.reduce((n, c) => n + c.tokens, 0)
    const pct = Math.round((onBoard / window) * 100)
    body = [tiles('k', [
      { label: 'In context', value: `${tok(onBoard)} · ${pct}%`, color: pct >= 85 ? INK.coral : pct >= 60 ? INK.amber : undefined },
      { label: 'Context window', value: tok(window) },
      { label: 'Per message', value: live.fixed === null ? '–' : money(readUsd(onBoard, live.model)) },
    ])]
    body.push(caption('ch', 'What every message sends', 'red line: 85%'))
    if (desktop) {
      const H = 22
      let x = 0
      let rects = `<rect x="0" y="3" width="${W}" height="${H - 6}" rx="${(H - 6) / 2}" fill="${FAINT}" opacity="0.14"/>`
      const order = [...cats].sort((a, b) => (a.name === 'Messages' ? 1 : 0) - (b.name === 'Messages' ? 1 : 0))
      rects += `<clipPath id="r"><rect x="0" y="3" width="${W}" height="${H - 6}" rx="${(H - 6) / 2}"/></clipPath><g clip-path="url(#r)">`
      for (const c of order) {
        const w = (c.tokens / window) * W
        rects += `<rect x="${x.toFixed(1)}" y="3" width="${Math.max(1, w - 1.5).toFixed(1)}" height="${H - 6}" fill="${SHADES[c.name] ?? FAINT}"/>`
        x += w
      }
      rects += `</g><line x1="${0.85 * W}" y1="0" x2="${0.85 * W}" y2="${H}" stroke="${INK.coral}" stroke-width="2" stroke-linecap="round"/>`
      body.push(Svg({ key: 'bar', alt: `Context ${pct}% of the window`, width: W, height: H, source: svg(W, H, rects) }))
    } else {
      body.push(Text({ key: 'bar', color: INK.cobalt, children: glyphMeter(onBoard / window, cols - 1) }))
    }
    const maxCat = Math.max(1, ...cats.map(c => c.tokens))
    for (const c of cats) body.push(barRow('c-' + c.name, c.name, c.tokens / maxCat, tok(c.tokens), SHADES[c.name] ?? FAINT))
    if (live.fixed !== null) body.push(note('fx', `${tok(live.fixed)} tokens of instructions, tools and memory are sent with every message, before your conversation even starts.`, INK.cobalt))
    if (live.mcp.length > 0) {
      const idle = live.mcp.filter(s => !live.mcpUsed.includes(s.server)).length
      body.push(caption('mh', 'MCP servers', idle ? `${idle} unused` : 'all in use'))
      const maxS = Math.max(1, ...live.mcp.map(s => s.tokens))
      for (const s of [...live.mcp].sort((a, b) => b.tokens - a.tokens)) {
        const isUsed = live.mcpUsed.includes(s.server)
        body.push(barRow('m-' + s.server, `${s.server}${isUsed ? '' : ' · unused'}`, s.tokens / maxS, tok(s.tokens), isUsed ? INK.orchid : INK.amber))
      }
    }
  }

  // ---------- Session ----------
  if (p.tab === 'session') {
    const turns = p.live.turns
    const recent = turns.slice(-48)
    const agents = p.live.weights.filter(w => w.isAgent)
    const agentUsd = agents.reduce((n, w) => n + (w.usd ?? 0), 0)
    const cold = turns.filter(t => t.isCold)
    const total = p.live.usd ?? turns.reduce((n, t) => n + t.usd, 0)
    body = [tiles('k', [
      { label: 'Messages', value: String(turns.length) },
      { label: 'Session cost', value: money(total) },
      { label: 'Subagents', value: agents.length ? `${Math.round((agentUsd / Math.max(0.0001, total)) * 100)}%` : '–', color: agents.length ? INK.orchid : undefined },
    ])]
    body.push(caption('ch', 'Cost per message', recent.length ? `last ${recent.length}` : undefined))
    const top = Math.max(0.0001, ...recent.map(t => t.usd))
    const colorOf = (t: { isCold: boolean; agentShare: number }) => (t.isCold ? INK.coral : t.agentShare >= 0.5 ? INK.orchid : INK.cobalt)
    if (recent.length === 0) {
      body.push(Text({ key: 'empty', dimColor: true, children: 'No messages yet in this session.' }))
    } else if (desktop) {
      const H = 104, base = H - 16, bw = Math.min(22, W / recent.length)
      let bars = ''
      for (const f of [0.5, 1]) bars += `<line x1="0" y1="${(base - f * (base - 12)).toFixed(1)}" x2="${W}" y2="${(base - f * (base - 12)).toFixed(1)}" stroke="${FAINT}" stroke-opacity="0.15" stroke-dasharray="2 3"/>`
      bars += `<line x1="0" y1="${base + 0.5}" x2="${W}" y2="${base + 0.5}" stroke="${FAINT}" stroke-opacity="0.4"/>`
      recent.forEach((t, i) => {
        const h = Math.max(2, (t.usd / top) * (base - 12))
        bars += `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${Math.max(1.5, bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colorOf(t)}" opacity="${t.isCold || t.agentShare >= 0.5 ? 1 : 0.75}"/>`
      })
      bars += `<text x="${W}" y="9" font-size="10" fill="${FAINT}" text-anchor="end">${esc(money(top))}</text>`
      if (recent.length > 1) bars += `<text x="0" y="${H - 2}" font-size="10" fill="${FAINT}">first</text><text x="${Math.min(W, recent.length * bw)}" y="${H - 2}" font-size="10" fill="${FAINT}" text-anchor="end">latest</text>`
      body.push(Svg({ key: 'chart', alt: 'Cost of each message this session', width: W, height: H, source: svg(W, H, bars) }))
    } else {
      body.push(Box({ key: 'spark', flexDirection: 'row', children: recent.map((t, i) => Text({ key: 's' + i, color: colorOf(t), children: SPARK[Math.min(7, Math.floor((t.usd / top) * 7.999))]! })) }))
    }
    body.push(Box({ key: 'lg', flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: [
      Text({ key: 'a', color: INK.cobalt, children: '● your message' }),
      Text({ key: 'b', color: INK.orchid, children: '● mostly subagents' }),
      Text({ key: 'c', color: INK.coral, children: '● cache had expired' }),
    ] }))
    if (cold.length) body.push(row('cold', `Messages after the cache expired · ${cold.length}`, money(cold.reduce((n, t) => n + t.usd, 0)), INK.coral))
    const tasks = tasksOf(turns)
    if (tasks.length) {
      const shown = tasks.slice(-8).reverse()
      const dear = Math.max(...tasks.map(t => t.usd))
      const maxT = Math.max(0.0001, ...shown.map(t => t.usd))
      body.push(caption('th', 'Cost per task', `latest ${shown.length} of ${tasks.length}`))
      shown.forEach((t, i) => {
        // No words: the request began before Usage Coach was loaded, or the session started without one.
        const what = t.prompt ? `“${t.prompt}”` : 'earlier request'
        body.push(barRow('t' + i, `${clockOf(t.at)} · ${what}`, t.usd / maxT, money(t.usd), colorOf(t)))
        const bits = [t.messages > 1 ? `${t.messages} messages` : '', t.tools ? `${t.tools} tool call${t.tools === 1 ? '' : 's'}` : '', t.isCold ? 'cache had expired' : '', t.usd === dear && tasks.length > 1 ? '▲ most expensive' : '']
        const line = bits.filter(Boolean).join(' · ')
        if (line) body.push(Text({ key: 'td' + i, dimColor: true, children: '   ' + line }))
      })
    }
    if (agents.length) {
      body.push(caption('ph', 'Subagents', 'latest 5'))
      const maxP = Math.max(1, ...agents.map(w => w.tokens))
      for (const w of agents.slice(-5).reverse()) {
        body.push(barRow('p-' + w.id, `${w.agentType ?? 'subagent'} · ${w.label}`, w.tokens / maxP, tok(w.tokens), INK.orchid))
        body.push(Text({ key: 'pd-' + w.id, dimColor: true, children: `   ${[w.ms ? seconds(w.ms) : '', w.usd ? money(w.usd) : '', w.model ? modelName(w.model) : ''].filter(Boolean).join(' · ')}` }))
      }
    }
    const outputs = p.live.weights.filter(w => !w.isAgent).sort((a, b) => b.tokens - a.tokens).slice(0, 3)
    if (outputs.length) {
      body.push(caption('hh', 'Largest tool outputs', 'sent with every message'))
      const maxC = Math.max(1, ...outputs.map(w => w.tokens))
      for (const w of outputs) body.push(barRow('h-' + w.id, `${w.tool} · ${w.label}`, w.tokens / maxC, tok(w.tokens), INK.amber))
    }
  }

  // ---------- History ----------
  if (p.tab === 'week') {
    if (p.weekBusy) {
      body = [Text({ key: 'busy', color: INK.cobalt, children: '◌ Reading the last 7 days…' }),
        Text({ key: 'why', dimColor: true, children: 'About 10 seconds, from the transcripts on this Mac. It costs no tokens.' })]
    } else if (!p.week) {
      body = [Text({ key: 'none', dimColor: true, children: 'The last 7 days, read from the session files on this Mac. No tokens.' }),
        Box({ key: 'b', marginTop: 1, children: [Button({ key: 'read', label: 'Load history', variant: 'primary', hotkey: 'r', onPress: act.readWeek })] })]
    } else {
      const w = p.week
      const s = summarize(w)
      const share = s.tokens ? s.subTokens / s.tokens : 0
      const sp = Math.round(share * 100)
      const trend = trendOf(w)
      body = [tiles('k', [
        { label: 'Tokens · 7 days', value: tok(s.tokens) },
        { label: 'Cost at list prices', value: money(s.usd) },
        { label: 'From cache', value: `${Math.round(s.readShare * 100)}%`, color: s.readShare >= 0.9 ? INK.mint : INK.amber },
      ])]
      if (trend) {
        const up = trend.change > 0
        body.push(note('trend', `${Math.round(Math.abs(trend.change) * 100)}% ${up ? 'more' : 'less'} than the week before (${money(trend.prevUsd)} → ${money(trend.usd)})` +
          (trend.project ? `. ${trend.project} accounts for ${Math.round(trend.projectShare * 100)}% of the difference.` : '.'), up ? INK.amber : INK.mint))
      }
      if (p.saved && p.saved.count) body.push(note('saved', `Usage Coach's compactions saved about ${money(p.saved.usd)} in 7 days (${p.saved.count} compaction${p.saved.count === 1 ? '' : 's'}).`, INK.mint))
      body.push(caption('wh', 'Who spent it', `${w.sessions} sessions`))
      if (desktop) {
        const H = 18, sw = share * W
        body.push(Svg({ key: 'split', alt: `Subagents ${sp}%, your chats ${100 - sp}%`, width: W, height: H, source: svg(W, H,
          `<clipPath id="s"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><g clip-path="url(#s)">` +
          `<rect x="0" y="0" width="${Math.max(0, sw - 1).toFixed(1)}" height="${H}" fill="${INK.orchid}"/>` +
          `<rect x="${(sw + 1).toFixed(1)}" y="0" width="${Math.max(0, W - sw - 1).toFixed(1)}" height="${H}" fill="${INK.cobalt}"/></g>`) }))
      } else {
        const n = Math.round(share * (cols - 1))
        body.push(Box({ key: 'split', flexDirection: 'row', children: [Text({ key: 'a', color: INK.orchid, children: '█'.repeat(n) }), Text({ key: 'b', color: INK.cobalt, children: '█'.repeat(cols - 1 - n) })] }))
      }
      body.push(
        Box({ key: 'lg', flexDirection: 'row', columnGap: 2, marginTop: 1, children: [
          Box({ key: 'a', flexGrow: 1, width: '50%', children: [legend('a', INK.orchid, `Subagents · ${sp}%`, 'Helpers Claude sends off on their own task')] }),
          Box({ key: 'b', flexGrow: 1, width: '50%', children: [legend('b', INK.cobalt, `You · ${100 - sp}%`, 'Your own conversations with Claude')] }),
        ] }),
        caption('ch', 'Expired cache', 'contexts over 100k'),
        row('cold', `${w.cold.count} times the cache had expired and everything was sent again`, money(s.coldUsd), w.cold.count ? INK.coral : undefined),
        caption('dh', 'Projects', 'by tokens'),
      )
      const topProject = Math.max(1, ...w.projects.map(x => x.tokens))
      for (const pr of w.projects.slice(0, 5)) body.push(barRow('p-' + pr.name, pr.name, pr.tokens / topProject, tok(pr.tokens), INK.cobalt))
      body.push(caption('lh', 'Lessons'))
      for (const [i, l] of s.lessons.entries()) body.push(note('l' + i, l, i === s.lessons.length - 1 && s.readShare >= 0.9 ? INK.mint : INK.amber))
      body.push(Box({ key: 'again', marginTop: 1, children: [Button({ key: 'again', label: 'Reload history', hotkey: 'r', plain: true, onPress: act.readWeek })] }))
    }
  }

  // ---------- Insights ----------
  if (p.tab === 'insights') {
    const card = (key: string, i: Insight) => Box({
      key, flexDirection: 'column', borderStyle: 'round', borderColor: TONE[i.tone], paddingX: 1, marginTop: 1,
      children: [
        Text({ key: 't', bold: true, color: TONE[i.tone], children: i.title }),
        Text({ key: 'w', dimColor: true, children: i.how }),
      ],
    })
    const model = p.insights.filter(i => i.kind === 'model')
    const habits = p.insights.filter(i => i.kind === 'habit')
    const urgent = p.insights.filter(i => i.kind === 'now')
    const weekly = p.insights.filter(i => i.kind === 'week')
    body = [tiles('k', [
      { label: 'Model', value: live.model ? modelName(live.model) : '–' },
      { label: 'Insights', value: String(p.insights.length), color: p.insights.length ? INK.amber : INK.mint },
      { label: 'Messages', value: String(live.turns.length) },
    ])]
    if (urgent.length) {
      body.push(caption('nh', 'Right now'))
      urgent.forEach((i, n) => body.push(card('n' + n, i)))
    }
    body.push(caption('mh', 'Model fit', model.length ? undefined : 'looks right'))
    if (model.length) model.forEach((i, n) => body.push(card('m' + n, i)))
    else body.push(Text({ key: 'm-ok', dimColor: true, children: live.turns.length >= 4 ? 'The model matches the work so far.' : 'A few more messages and Usage Coach can tell whether the model fits the work.' }))
    body.push(caption('hh', 'This session', habits.length ? undefined : 'nothing to change'))
    if (habits.length) habits.forEach((i, n) => body.push(card('h' + n, i)))
    else body.push(Text({ key: 'h-ok', dimColor: true, children: 'Cache, context and subagents look healthy.' }))
    if (weekly.length) {
      body.push(caption('wh', 'This week'))
      weekly.forEach((i, n) => body.push(card('w' + n, i)))
    }
    body.push(caption('gh', 'Good habits'))
    HABITS.forEach((h, n) => body.push(note('g' + n, h, INK.cobalt)))
  }

  // ---------- Footer: cache and usage limits at a glance ----------
  const left = cacheLeft(live, p.now)
  const limitRows = live.limits.map(l => limitOf(l, p.now)).filter(r => r.left === null || r.left > 0)
  const footer = Box({ key: 'foot', flexDirection: 'row', columnGap: 3, children: [
    ...(left !== null ? [Box({ key: 'o', flexDirection: 'row', columnGap: 1, children: [
      Text({ key: 'l', dimColor: true, children: 'Cache' }),
      Text({ key: 'v', bold: true, ...(left <= 0 ? { color: INK.coral } : left <= cacheWarnAt(live) ? { color: INK.amber } : {}), children: left > 0 ? span(left) : 'expired' }),
    ] })] : []),
    ...limitRows.map(r => Box({ key: 'f' + r.label, flexDirection: 'row', columnGap: 1, children: [
      Text({ key: 'l', dimColor: true, children: 'Limit ' + r.label }),
      Text({ key: 'v', bold: true, ...(r.tone === 'calm' ? {} : { color: TONE[r.tone] }), children: `${Math.max(0, 100 - Math.round(r.used))}%` }),
    ] })),
  ] })

  return Box({ flexDirection: 'column', width: cols, children: [
    head, divider('d0'), today, ...todayNote, gap('gt'), tabs, gap('g0'), ...body, gap('g1'), divider('d1'), footer,
  ] })
}
