// The Mission Control pane: a status line, then Maneuvers (what to do), Payload (what every
// request carries), Flight log (this session, message by message) and History (the last 7 days).
// Pure drawing. Each tab opens on a row of readout tiles. The desktop draws its bars and charts
// as SVG; the terminal draws the same in glyphs.

import type { Category, Live, Tab, Week } from '../types'
import { fuseLeft, money, seconds, span, tok } from './moves'
import type { Move } from './moves'
import { INK, raceOf } from './strip'
import { readUsd } from './prices'
import { summarize } from './week'

export type PaneInput = {
  tab: Tab
  live: Live
  moves: Move[]
  categories: Category[]
  week: Week | null
  weekBusy: boolean
  columns: number
  now: number
  desktop: boolean
}

export type PaneActions = {
  setTab: (tab: Tab) => void
  compact: () => void
  readWeek: () => void
}

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'moves', label: 'Maneuvers', hotkey: '1' },
  { tab: 'tank', label: 'Payload', hotkey: '2' },
  { tab: 'session', label: 'Flight log', hotkey: '3' },
  { tab: 'week', label: 'History', hotkey: '4' },
]
const TONE: Record<string, string> = { calm: INK.mint, warn: INK.amber, hot: INK.coral }
/** CSS pixels per column in the desktop pane, measured on screen. */
const PX = 7.85
const SPARK = '▁▂▃▄▅▆▇█'
const SANS = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
const FAINT = '#8a93a6'

/** Claude's category names, as the crew reads them. */
const NAMES: Record<string, string> = {
  'Messages': 'Conversation',
  'System prompt': 'Instructions',
  'System tools': 'Tools',
  'MCP tools': 'MCP modules',
  'Memory files': 'Memory',
  'Skills': 'Skills',
  'Custom agents': 'Agents',
}
const SHADES: Record<string, string> = {
  'Conversation': INK.cobalt,
  'Instructions': '#6b7488',
  'Tools': '#9aa3b5',
  'MCP modules': INK.orchid,
  'Memory': INK.mint,
  'Skills': INK.amber,
  'Agents': '#c7cbd6',
}

type Tile = { label: string; value: string; color?: string }

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

export function statusOf(moves: Move[]) {
  const top = moves[0]
  if (!top || top.tone === 'calm') return { word: 'NOMINAL', color: INK.mint }
  return top.tone === 'warn' ? { word: 'ADVISORY', color: INK.amber } : { word: 'ALERT', color: INK.coral }
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
  const status = statusOf(p.moves)
  const elapsed = live.startedAt ? 'T+' + span(p.now - live.startedAt) : 'T+0'
  const model = live.model.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
  const head = Box({ key: 'head', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', children: [
    Box({ key: 'l', flexDirection: 'row', columnGap: 1, children: [
      Text({ key: 's', bold: true, color: status.color, children: '● ' + status.word }),
      Text({ key: 'm', dimColor: true, children: [elapsed, model].filter(Boolean).join(' · ') }),
    ] }),
    Text({ key: 'c', bold: true, children: live.usd === null ? '–' : money(live.usd) }),
  ] })

  const tabs = Box({ key: 'tabs', flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: TABS.map(t =>
    Button({ key: 'tab-' + t.tab, label: t.label, hotkey: t.hotkey, ...(t.tab === p.tab ? { variant: 'primary' } : { plain: true }), onPress: () => act.setTab(t.tab) })) })

  let body: unknown[] = []

  // ---------- Maneuvers ----------
  if (p.tab === 'moves') {
    if (p.moves.length === 0) {
      body = [
        ...(desktop ? [Svg({ key: 'orbit', alt: 'All systems nominal', width: W, height: 84, source: svg(W, 84,
          `<ellipse cx="${W / 2}" cy="42" rx="${Math.min(160, W / 2 - 12)}" ry="24" fill="none" stroke="${INK.mint}" stroke-opacity="0.35" stroke-width="1.2"/>` +
          `<ellipse cx="${W / 2}" cy="42" rx="${Math.min(100, W / 3)}" ry="14" fill="none" stroke="${INK.mint}" stroke-opacity="0.2" stroke-dasharray="2 4"/>` +
          `<circle cx="${W / 2}" cy="42" r="10" fill="${INK.cobalt}" opacity="0.9"/>` +
          `<circle cx="${W / 2 + Math.min(160, W / 2 - 12) * 0.8}" cy="27" r="4" fill="${INK.mint}"/>`) })] : []),
        Text({ key: 'ok', bold: true, color: INK.mint, children: 'All systems nominal' }),
        Text({ key: 'why', dimColor: true, children: 'Payload, orbit and fuel are steady. A maneuver appears here when a change would save tokens.' }),
      ]
    } else {
      const now = p.moves.filter(m => m.unit === 'now').reduce((n, m) => n + m.usd, 0)
      body = [
        tiles('k', [
          { label: 'Maneuvers', value: String(p.moves.length), color: TONE[p.moves[0]!.tone] },
          { label: 'Save now', value: now > 0.01 ? '≈ ' + money(now) : '–', color: now > 0.01 ? INK.mint : undefined },
          { label: 'Payload', value: live.tokens === null ? '–' : tok(live.tokens) },
        ]),
        ...p.moves.map((m, i) => Box({
          key: 'm' + i, flexDirection: 'column', borderStyle: 'round', borderColor: TONE[m.tone], paddingX: 1, marginTop: 1,
          children: [
            Box({ key: 'h', flexDirection: 'row', justifyContent: 'space-between', columnGap: 2, children: [
              Box({ key: 't', flexShrink: 1, children: [Text({ key: 't', bold: true, color: TONE[m.tone], children: m.title })] }),
              ...(m.usd > 0.01 ? [Box({ key: 's', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, children: [
                Text({ key: 'v', bold: true, children: '≈ ' + money(m.usd) }),
                Text({ key: 'u', dimColor: true, children: m.unit === 'now' ? 'saved now' : 'saved ' + m.unit }),
              ] })] : []),
            ] }),
            Text({ key: 'w', dimColor: true, children: m.how }),
            ...(m.key === 'c' ? [Box({ key: 'do', marginTop: 1, marginBottom: 0, children: [Button({ key: 'do', label: 'Compact now', variant: 'primary', onPress: act.compact })] })] : []),
          ],
        })),
      ]
    }
  }

  // ---------- Payload ----------
  if (p.tab === 'tank') {
    const window = live.window || 1
    const cats = p.categories.map(c => ({ name: NAMES[c.name] ?? c.name, tokens: c.tokens }))
    const onBoard = live.tokens ?? cats.reduce((n, c) => n + c.tokens, 0)
    const pct = Math.round((onBoard / window) * 100)
    body = [tiles('k', [
      { label: 'On board', value: `${tok(onBoard)} · ${pct}%`, color: pct >= 85 ? INK.coral : pct >= 60 ? INK.amber : undefined },
      { label: 'Window', value: tok(window) },
      { label: 'Per request', value: live.fixed === null ? '–' : money(readUsd(onBoard, live.model)) },
    ])]
    body.push(caption('ch', 'What every request carries', '85% red line'))
    if (desktop) {
      const H = 22
      let x = 0
      let rects = `<rect x="0" y="3" width="${W}" height="${H - 6}" rx="${(H - 6) / 2}" fill="${FAINT}" opacity="0.14"/>`
      const order = [...cats].sort((a, b) => (a.name === 'Conversation' ? 1 : 0) - (b.name === 'Conversation' ? 1 : 0))
      rects += `<clipPath id="r"><rect x="0" y="3" width="${W}" height="${H - 6}" rx="${(H - 6) / 2}"/></clipPath><g clip-path="url(#r)">`
      for (const c of order) {
        const w = (c.tokens / window) * W
        rects += `<rect x="${x.toFixed(1)}" y="3" width="${Math.max(1, w - 1.5).toFixed(1)}" height="${H - 6}" fill="${SHADES[c.name] ?? FAINT}"/>`
        x += w
      }
      rects += `</g><line x1="${0.85 * W}" y1="0" x2="${0.85 * W}" y2="${H}" stroke="${INK.coral}" stroke-width="2" stroke-linecap="round"/>`
      body.push(Svg({ key: 'bar', alt: `Payload ${pct}% of the window`, width: W, height: H, source: svg(W, H, rects) }))
    } else {
      body.push(Text({ key: 'bar', color: INK.cobalt, children: glyphMeter(onBoard / window, cols - 1) }))
    }
    const maxCat = Math.max(1, ...cats.map(c => c.tokens))
    for (const c of cats) body.push(barRow('c-' + c.name, c.name, c.tokens / maxCat, tok(c.tokens), SHADES[c.name] ?? FAINT))
    if (live.fixed !== null) body.push(note('fx', `${tok(live.fixed)} of instructions, tools and memory ride on every request before your conversation even starts.`, INK.cobalt))
    if (live.mcp.length > 0) {
      const idle = live.mcp.filter(s => !live.mcpUsed.includes(s.server)).length
      body.push(caption('mh', 'MCP modules', idle ? `${idle} idle` : 'all in use'))
      const maxS = Math.max(1, ...live.mcp.map(s => s.tokens))
      for (const s of [...live.mcp].sort((a, b) => b.tokens - a.tokens)) {
        const isUsed = live.mcpUsed.includes(s.server)
        body.push(barRow('m-' + s.server, `${s.server}${isUsed ? '' : ' · idle'}`, s.tokens / maxS, tok(s.tokens), isUsed ? INK.orchid : INK.amber))
      }
    }
  }

  // ---------- Flight log ----------
  if (p.tab === 'session') {
    const turns = p.live.turns
    const recent = turns.slice(-48)
    const probes = p.live.weights.filter(w => w.isAgent)
    const probeUsd = probes.reduce((n, w) => n + (w.usd ?? 0), 0)
    const cold = turns.filter(t => t.isCold)
    const total = p.live.usd ?? turns.reduce((n, t) => n + t.usd, 0)
    body = [tiles('k', [
      { label: 'Messages', value: String(turns.length) },
      { label: 'Mission cost', value: money(total) },
      { label: 'Subagents', value: probes.length ? `${Math.round((probeUsd / Math.max(0.0001, total)) * 100)}%` : '–', color: probes.length ? INK.orchid : undefined },
    ])]
    body.push(caption('ch', 'Cost per message', recent.length ? `last ${recent.length}` : undefined))
    const top = Math.max(0.0001, ...recent.map(t => t.usd))
    const colorOf = (t: { isCold: boolean; agentShare: number }) => (t.isCold ? INK.coral : t.agentShare >= 0.5 ? INK.orchid : INK.cobalt)
    if (recent.length === 0) {
      body.push(Text({ key: 'empty', dimColor: true, children: 'No messages logged yet in this flight.' }))
    } else if (desktop) {
      const H = 104, base = H - 16, bw = Math.min(22, W / recent.length)
      let bars = ''
      for (const f of [0.5, 1]) bars += `<line x1="0" y1="${(base - f * (base - 12)).toFixed(1)}" x2="${W}" y2="${(base - f * (base - 12)).toFixed(1)}" stroke="${FAINT}" stroke-opacity="0.15" stroke-dasharray="2 3"/>`
      bars += `<line x1="0" y1="${base + 0.5}" x2="${W}" y2="${base + 0.5}" stroke="${FAINT}" stroke-opacity="0.4"/>`
      recent.forEach((t, i) => {
        const h = Math.max(2, (t.usd / top) * (base - 12))
        bars += `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${Math.max(1.5, bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colorOf(t)}" opacity="${t.isCold || t.agentShare >= 0.5 ? 1 : 0.75}"/>`
      })
      bars += `<text x="${W}" y="9" font-size="10" fill="${FAINT}" text-anchor="end">${money(top)}</text>`
      bars += `<text x="0" y="${H - 2}" font-size="10" fill="${FAINT}">first</text><text x="${Math.min(W, recent.length * bw)}" y="${H - 2}" font-size="10" fill="${FAINT}" text-anchor="end">latest</text>`
      body.push(Svg({ key: 'chart', alt: 'Cost of each message this session', width: W, height: H, source: svg(W, H, bars) }))
    } else {
      body.push(Box({ key: 'spark', flexDirection: 'row', children: recent.map((t, i) => Text({ key: 's' + i, color: colorOf(t), children: SPARK[Math.min(7, Math.floor((t.usd / top) * 7.999))]! })) }))
    }
    body.push(Box({ key: 'lg', flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: [
      Text({ key: 'a', color: INK.cobalt, children: '● your message' }),
      Text({ key: 'b', color: INK.orchid, children: '● mostly subagents' }),
      Text({ key: 'c', color: INK.coral, children: '● cold cache' }),
    ] }))
    if (cold.length) body.push(row('cold', `Cold orbit returns · ${cold.length}`, money(cold.reduce((n, t) => n + t.usd, 0)), INK.coral))
    if (probes.length) {
      body.push(caption('ph', 'Probes launched', 'subagents'))
      const maxP = Math.max(1, ...probes.map(w => w.tokens))
      for (const w of probes.slice(-5).reverse()) {
        body.push(barRow('p-' + w.id, `${w.agentType ?? 'probe'} · ${w.label}`, w.tokens / maxP, tok(w.tokens), INK.orchid))
        body.push(Text({ key: 'pd-' + w.id, dimColor: true, children: `   ${[w.ms ? seconds(w.ms) : '', w.usd ? '≈ ' + money(w.usd) : '', w.model ? w.model.replace(/^claude-/, '') : ''].filter(Boolean).join(' · ')}` }))
      }
    }
    const cargo = p.live.weights.filter(w => !w.isAgent).sort((a, b) => b.tokens - a.tokens).slice(0, 3)
    if (cargo.length) {
      body.push(caption('hh', 'Heavy cargo', 'big tool outputs'))
      const maxC = Math.max(1, ...cargo.map(w => w.tokens))
      for (const w of cargo) body.push(barRow('h-' + w.id, `${w.tool} · ${w.label}`, w.tokens / maxC, tok(w.tokens), INK.amber))
    }
  }

  // ---------- History ----------
  if (p.tab === 'week') {
    if (p.weekBusy) {
      body = [Text({ key: 'busy', color: INK.cobalt, children: '◌ Reading the last 7 days of flights…' }),
        Text({ key: 'why', dimColor: true, children: 'About 6 seconds, from the transcripts on this Mac. It costs no tokens.' })]
    } else if (!p.week) {
      body = [Text({ key: 'none', dimColor: true, children: 'The last 7 days of flights, read from the transcripts on this Mac. No tokens.' }),
        Box({ key: 'b', marginTop: 1, children: [Button({ key: 'read', label: 'Load history', variant: 'primary', hotkey: 'r', onPress: act.readWeek })] })]
    } else {
      const w = p.week
      const s = summarize(w)
      const share = s.tokens ? s.subTokens / s.tokens : 0
      const sp = Math.round(share * 100)
      body = [tiles('k', [
        { label: 'Tokens · 7 days', value: tok(s.tokens) },
        { label: 'Equivalent cost', value: '≈ ' + money(s.usd) },
        { label: 'From cache', value: `${Math.round(s.readShare * 100)}%`, color: s.readShare >= 0.9 ? INK.mint : INK.amber },
      ])]
      body.push(caption('wh', 'Who spent it', `${w.sessions} flights`))
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
          Box({ key: 'a', flexGrow: 1, width: '50%', children: [legend('a', INK.orchid, `Probes · ${sp}%`, 'Subagents: helpers Claude sends off on their own task')] }),
          Box({ key: 'b', flexGrow: 1, width: '50%', children: [legend('b', INK.cobalt, `Crew · ${100 - sp}%`, 'Your own conversations with Claude')] }),
        ] }),
        caption('ch', 'Cold orbit returns', 'contexts over 100k'),
        row('cold', `${w.cold.count} times the cache went cold and was rewritten`, '≈ ' + money(s.coldUsd), w.cold.count ? INK.coral : undefined),
        caption('dh', 'Destinations', 'by tokens'),
      )
      const topProject = Math.max(1, ...w.projects.map(x => x.tokens))
      for (const pr of w.projects.slice(0, 5)) body.push(barRow('p-' + pr.name, pr.name, pr.tokens / topProject, tok(pr.tokens), INK.cobalt))
      body.push(caption('lh', 'Debrief'))
      for (const [i, l] of s.lessons.entries()) body.push(note('l' + i, l, i === s.lessons.length - 1 && s.readShare >= 0.9 ? INK.mint : INK.amber))
      body.push(Box({ key: 'again', marginTop: 1, children: [Button({ key: 'again', label: 'Reload history', hotkey: 'r', plain: true, onPress: act.readWeek })] }))
    }
  }

  // ---------- Footer: orbit and fuel at a glance ----------
  const left = fuseLeft(live, p.now)
  const fuel = live.limits.map(l => raceOf(l, p.now)).filter(r => r.left === null || r.left > 0)
  const footer = Box({ key: 'foot', flexDirection: 'row', columnGap: 3, children: [
    ...(left !== null ? [Box({ key: 'o', flexDirection: 'row', columnGap: 1, children: [
      Text({ key: 'l', dimColor: true, children: 'Orbit' }),
      Text({ key: 'v', bold: true, ...(left <= 0 ? { color: INK.coral } : left <= 15 * 60_000 ? { color: INK.amber } : {}), children: left > 0 ? span(left) : 'decayed' }),
    ] })] : []),
    ...fuel.map(r => Box({ key: 'f' + r.label, flexDirection: 'row', columnGap: 1, children: [
      Text({ key: 'l', dimColor: true, children: 'Fuel ' + r.label }),
      Text({ key: 'v', bold: true, ...(r.tone === 'calm' ? {} : { color: TONE[r.tone] }), children: `${Math.max(0, 100 - Math.round(r.used))}%` }),
    ] })),
  ] })

  return Box({ flexDirection: 'column', width: cols, children: [
    head, divider('d0'), tabs, gap('g0'), ...body, gap('g1'), divider('d1'), footer,
  ] })
}
