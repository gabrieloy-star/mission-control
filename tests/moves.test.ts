import { expect, test } from 'claude-code/testing'

import type { Live } from '../types'
import { HOUR, MINUTE, movesOf, tipOf } from '../hooks/moves'
import { compactUsd, priceOf, rewriteUsd } from '../hooks/prices'
import { drawStrip, familyWeek, statusCard } from '../hooks/strip'
import { drawPane } from '../hooks/pane'
import { summarize } from '../hooks/week'

const NOW = Date.parse('2026-10-18T15:00:00Z')
const USD = { currency: 'USD' as const, brlPerUsd: 5.4 }
const SETTINGS = { minTokens: 40_000, money: USD, budget: 100 }

function live(over: Partial<Live> = {}): Live {
  return {
    startedAt: NOW - HOUR, tokens: 186_000, window: 1_000_000, fixed: 46_000, conversation: 140_000, adds: [3_000, 31_000],
    cacheAt: NOW - 10 * MINUTE, model: 'claude-opus-5-5', limits: [], usd: 9.8, turnBase: 5.68,
    turns: [], weights: [], mcp: [], mcpUsed: [], budgetWarned: false, lastToastAt: 0, ...over,
  }
}

test('prices follow the current list', () => {
  expect(priceOf('claude-opus-5-5[1m]')).toEqual({ input: 4, output: 20, read: 0.2 })
  expect(priceOf('claude-fable-5-1').read).toBe(0.25)
  expect(priceOf('claude-haiku-5-5').input).toBe(0.1)
  // A cold 200k return on Opus 5.5: 200k at twice $4 per million.
  expect(Math.round(rewriteUsd(200_000, 'claude-opus-5-5') * 100)).toBe(160)
  expect(compactUsd(200_000, 'claude-opus-5-5')).toBeLessThan(0.3)
})

test('a warm, quiet session has nothing to fix', () => {
  expect(movesOf(live({ tokens: 60_000, conversation: 20_000 }), NOW, SETTINGS)).toEqual([])
})

test('a short fuse offers to compact, with the saving', () => {
  const moves = movesOf(live({ cacheAt: NOW - 50 * MINUTE }), NOW, SETTINGS)
  expect(moves[0]!.id).toBe('break')
  expect(moves[0]!.key).toBe('c')
  expect(moves[0]!.usd).toBeGreaterThan(0.8)
  expect(tipOf(moves[0], USD)).toContain('press c')
})

test('a cold, huge context suggests a fresh thread, not a resend', () => {
  const moves = movesOf(live({ tokens: 320_000, conversation: 274_000, cacheAt: NOW - 2 * HOUR }), NOW, SETTINGS)
  expect(moves[0]!.id).toBe('fresh')
  expect(moves[0]!.tone).toBe('hot')
})

test('idle MCP servers are named once a few messages went by', () => {
  const turn = { at: NOW, ms: 1000, added: 0, usd: 0.1, cached: 1, agentShare: 0, isCold: false }
  const l = live({ mcp: [{ server: 'linear', tokens: 9_000 }, { server: 'github', tokens: 6_000 }], mcpUsed: ['github'], turns: [turn, turn, turn] })
  const mcp = movesOf(l, NOW, SETTINGS).find(m => m.id === 'mcp')!
  expect(mcp.title).toBe('Power down 1 idle MCP module')
  expect(mcp.how).toContain('linear')
})

test('a heavy general-purpose subagent points to Explore', () => {
  const l = live({ weights: [{ id: 'a', tool: 'Agent', label: 'find callers', tokens: 17_500_000, isAgent: true, usd: 3.5, agentType: 'general-purpose' }] })
  expect(movesOf(l, NOW, SETTINGS).some(m => m.id === 'explore')).toBe(true)
})

// A stand-in element table: each element is its props, so the strip's choices can be read back.
const el = {
  Box: (p: any) => ({ type: 'Box', ...p }),
  Text: (p: any) => ({ type: 'Text', ...p }),
  Button: (p: any) => ({ type: 'Button', ...p }),
  Svg: (p: any) => ({ type: 'Svg', ...p }),
}

// Props the engine's Box accepts; anything else makes it refuse the whole tree.
const BOX_PROPS = new Set(['type', 'key', 'children', 'hover', 'position', 'top', 'left', 'right', 'bottom', 'flexDirection', 'flexGrow', 'flexShrink',
  'flexWrap', 'alignItems', 'alignSelf', 'justifyContent', 'gap', 'columnGap', 'rowGap', 'width', 'height', 'minWidth', 'minHeight', 'margin',
  'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom',
  'paddingLeft', 'paddingRight', 'borderStyle', 'borderColor', 'borderDimColor', 'backgroundColor', 'overflow', 'display'])

function refusedBoxProps(node: any, found: string[] = []): string[] {
  if (Array.isArray(node)) { for (const n of node) refusedBoxProps(n, found); return found }
  if (!node || typeof node !== 'object') return found
  if (node.type === 'Box') for (const k of Object.keys(node)) if (!BOX_PROPS.has(k)) found.push(k)
  refusedBoxProps(node.children, found)
  return found
}

function partsAt(columns: number, desktop: boolean) {
  const l = live({ limits: [{ kind: 'five_hour', percentUsed: 61 }, { kind: 'seven_day', percentUsed: 41 }], cacheAt: NOW - 52 * MINUTE })
  const tree: any = drawStrip(el, { live: l, week: null, move: movesOf(l, NOW, SETTINGS)[0], money: USD, now: NOW, columns, desktop, onMove() {}, onOpen() {} })
  return (tree.children as any[]).map(c => c.key as string)
}

test('the ⋯ card shows both fuel windows with refuel times and the week of Fable', () => {
  const t = (n: number) => ({ input: 0, output: 0, read: n, write5m: 0, write1h: 0 })
  const week = {
    at: NOW, since: '7d', sessions: 1, requests: 1, main: { 'claude-fable-5-1': t(40_000_000), 'claude-opus-5-5': t(9_000_000) },
    sub: { 'claude-fable-5-1': t(10_000_000) }, agentTypes: {}, cold: { count: 0, byModel: {} }, projects: [],
  }
  const l = live({ limits: [
    { kind: 'five_hour', percentUsed: 61, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 50 * HOUR).toISOString() },
  ] })
  const card = statusCard({ live: l, week, move: undefined, money: USD, now: NOW, columns: 160, desktop: true, onMove() {}, onOpen() {} })
  const text = card.rows.map(r => `${r.label} ${r.value ?? ''}`).join('\n')
  expect(text).toContain('Fuel · 5 hours 39% left · refuels in 2h00')
  expect(text).toContain('Fuel · 7 days 59% left · refuels in 2d2h')
  expect(text).toContain('Fable · 7 days 50M')
  expect(familyWeek(week, 'fable').tokens).toBe(50_000_000)
})

test('the strip keeps the most important parts that fit, on one line', () => {
  for (const desktop of [false, true]) {
    const wide = partsAt(160, desktop)
    expect(wide).toEqual(['tank', 'fuse', 'race-five_hour', 'race-seven_day', 'spend', 'move', 'open'])
    const narrow = partsAt(60, desktop)
    expect(narrow[0]).toBe('tank')
    expect(narrow).toContain('move')
    expect(narrow).toContain('open')
    expect(narrow).not.toContain('race-seven_day')
  }
})

test('the week folds into money and lessons', () => {
  const t = (read: number) => ({ input: 0, output: 1_000_000, read, write5m: 0, write1h: 10_000_000 })
  const s = summarize({
    at: NOW, since: '7d', sessions: 10, requests: 100,
    main: { 'claude-opus-5-5': t(300_000_000) }, sub: { 'claude-opus-5-5': t(900_000_000) },
    agentTypes: { 'general-purpose': { runs: 30, tokens: 900_000_000 } }, cold: { count: 12, byModel: { 'claude-opus-5-5': 2_400_000 } }, projects: [],
  }, USD)
  expect(s.lessons[0]).toContain('Probes (subagents) spent')
  expect(s.lessons.some(l => l.includes('12 times'))).toBe(true)
})

test('every pane tab draws on both surfaces without throwing', () => {
  const l = live({
    limits: [{ kind: 'five_hour', percentUsed: 61, resetsAt: new Date(NOW + 2 * HOUR).toISOString() }],
    turns: [{ at: NOW, ms: 42_000, added: 8_400, usd: 0.14, cached: 0.96, agentShare: 0, isCold: false }, { at: NOW, ms: 160_000, added: 31_000, usd: 4.12, cached: 0.9, agentShare: 0.83, isCold: false }],
    weights: [{ id: 'a', tool: 'Agent', label: 'find callers', tokens: 17_500_000, isAgent: true, usd: 3.5, agentType: 'general-purpose' }],
    mcp: [{ server: 'linear', tokens: 9_000 }],
  })
  const t = (read: number) => ({ input: 0, output: 1_000_000, read, write5m: 0, write1h: 10_000_000 })
  const wk = { at: NOW, since: '7d', sessions: 10, requests: 100, main: { 'claude-opus-5-5': t(3e8) }, sub: { 'claude-opus-5-5': t(9e8) },
    agentTypes: { 'general-purpose': { runs: 30, tokens: 9e8 } }, cold: { count: 12, byModel: { 'claude-opus-5-5': 2_400_000 } }, projects: [{ name: 'shop', tokens: 1e9 }] }
  for (const desktop of [false, true]) {
    for (const tab of ['moves', 'tank', 'session', 'week'] as const) {
      const tree: any = drawPane(el, { tab, live: l, moves: movesOf(l, NOW, SETTINGS), categories: [{ name: 'Messages', tokens: 140_000 }, { name: 'System prompt', tokens: 12_000 }],
        week: wk, weekBusy: false, money: USD, columns: 56, now: NOW, desktop }, { setTab() {}, compact() {}, readWeek() {} })
      expect(tree.type).toBe('Box')
      expect(JSON.stringify(tree)).not.toContain('"plain":false')
      expect(refusedBoxProps(tree)).toEqual([])
    }
  }
})
