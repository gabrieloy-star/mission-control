#!/usr/bin/env node
// Mission Control's week scanner: sums the token usage Claude Code recorded in your local
// transcripts (~/.claude/projects) over the last N days. Reads files only; sends nothing.
// Usage: node week.mjs [--days 7] [--root <projects dir>]
// Prints one JSON object: tokens by model for main conversations and subagents, subagent runs
// by type, cold cache rewrites over 100k, and the top projects.

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const days = Number(opt('--days', '7')) || 7
const root = opt('--root', join(homedir(), '.claude', 'projects'))
const since = Date.now() - days * 24 * 3600_000
const COLD_AT = 100_000

const zero = () => ({ input: 0, output: 0, read: 0, write5m: 0, write1h: 0 })
const main = {}
const sub = {}
const agentTypes = {}
const cold = { count: 0, byModel: {} }
const projects = new Map()
const sessions = new Set()
let requests = 0

/** "-Users-me-apps-dev-shop--claude-worktrees-x" -> "shop". */
function projectName(dir) {
  const base = dir.split('--claude-worktrees-')[0]
  const marker = base.lastIndexOf('-apps-dev-')
  if (marker >= 0) return base.slice(marker + '-apps-dev-'.length) || base
  const parts = base.split('-').filter(Boolean)
  return parts.slice(-1)[0] || 'home'
}

function* jsonlFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const path = join(dir, e.name)
    if (e.isDirectory()) yield* jsonlFiles(path)
    else if (e.name.endsWith('.jsonl')) {
      try {
        if (statSync(path).mtimeMs >= since) yield path
      } catch {
        // Gone while scanning.
      }
    }
  }
}

function agentTypeOf(file) {
  const meta = file.replace(/\.jsonl$/, '.meta.json')
  if (!existsSync(meta)) return 'agent'
  try {
    return JSON.parse(readFileSync(meta, 'utf8')).agentType || 'agent'
  } catch {
    return 'agent'
  }
}

async function scan(file, project) {
  const isSub = file.includes('/subagents/')
  const seen = new Set()
  let tokens = 0
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const msg = row.message
    const u = msg?.usage
    if (!u || !msg.id || seen.has(msg.id)) continue
    seen.add(msg.id)
    const ts = Date.parse(row.timestamp ?? '')
    if (!Number.isFinite(ts) || ts < since) continue
    const model = msg.model || 'unknown'
    if (model === '<synthetic>') continue
    const bucket = (isSub || row.isSidechain ? sub : main)
    const t = (bucket[model] ??= zero())
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
    t.input += u.input_tokens ?? 0
    t.output += u.output_tokens ?? 0
    t.read += u.cache_read_input_tokens ?? 0
    t.write5m += w5m
    t.write1h += w1h
    const total = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + w5m + w1h
    tokens += total
    requests++
    if (row.sessionId) sessions.add(row.sessionId)
    if (w5m + w1h >= COLD_AT) {
      cold.count++
      cold.byModel[model] = (cold.byModel[model] ?? 0) + w5m + w1h
    }
  }
  if (isSub && tokens > 0) {
    const type = agentTypeOf(file)
    const a = (agentTypes[type] ??= { runs: 0, tokens: 0 })
    a.runs++
    a.tokens += tokens
  }
  projects.set(project, (projects.get(project) ?? 0) + tokens)
}

let dirs = []
try {
  dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
} catch {
  // No transcripts: an empty week.
}
for (const dir of dirs) {
  const project = projectName(dir)
  for (const file of jsonlFiles(join(root, dir))) await scan(file, project)
}

process.stdout.write(JSON.stringify({
  since: `${days}d`,
  sessions: sessions.size,
  requests,
  main,
  sub,
  agentTypes,
  cold,
  projects: [...projects].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens).slice(0, 8),
}))
