/** A rate-limit window as Claude reports it: `five_hour`, `seven_day`, or a gateway's. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** One main-loop turn, as the ledger line and the Session tab read it. */
export type Turn = {
  /** When it ended, in `$.clock.now()` milliseconds. */
  at: number
  ms: number
  /** Context tokens it added (0 after a compaction). */
  added: number
  /** Dollars it cost at list prices. */
  usd: number
  /** Share of its input read from the prompt cache, 0 to 1. */
  cached: number
  /** Share of its cost spent by subagents, 0 to 1. */
  agentShare: number
  /** True when its first request found the cache expired and wrote the context again. */
  isCold: boolean
  /** Output tokens the main loop wrote. */
  out?: number
  /** Tool calls the main loop made. */
  tools?: number
  /** The model that answered. */
  model?: string
}

/** A heavy tool output or a subagent run: what the weight under its row shows. */
export type Weight = {
  id: string
  tool: string
  label: string
  tokens: number
  isAgent: boolean
  usd?: number
  ms?: number
  model?: string
  agentType?: string
}

/** What the strip and the pane draw from. Plain data: the host keeps it across reloads. */
export type Live = {
  /** When the session began, in `$.clock.now()` milliseconds: the flight's T+0. */
  startedAt: number | null
  /** Context tokens now, and the window they fill. */
  tokens: number | null
  window: number
  /** Tokens every request carries before the conversation: system prompt, tools, memory, skills. */
  fixed: number | null
  /** Conversation tokens (the part a compaction shrinks). */
  conversation: number | null
  /** Tokens each recent turn added, oldest first. */
  adds: number[]
  /** Start of the last main-loop request: the prompt cache's lifetime runs from here. */
  cacheAt: number | null
  /** How long the prompt cache lives: 1 hour, or 5 minutes when Claude writes the short cache. */
  cacheTtl?: number
  model: string
  limits: Limit[]
  usd: number | null
  /** Session cost when the current turn started. */
  turnBase: number | null
  turns: Turn[]
  weights: Weight[]
  /** MCP servers whose tool schemas ride on every request, with their tokens. */
  mcp: { server: string; tokens: number }[]
  /** MCP servers called at least once this session. */
  mcpUsed: string[]
  budgetWarned: boolean
  lastToastAt: number
}

export type Tab = 'moves' | 'tank' | 'session' | 'week' | 'insights'

/** Tokens by kind, as the week scanner sums them. */
export type Tokens = { input: number; output: number; read: number; write5m: number; write1h: number }

/** The week scanner's report (scripts/week.mjs), stamped with when it was read. */
export type Week = {
  at: number
  since: string
  sessions: number
  requests: number
  /** Tokens by model, main conversations and subagents apart. */
  main: Record<string, Tokens>
  sub: Record<string, Tokens>
  /** Subagent runs by agent type: runs and total tokens. */
  agentTypes: Record<string, { runs: number; tokens: number }>
  /** Requests that wrote 100k or more of context to the cache (a cold return), by model. */
  cold: { count: number; byModel: Record<string, number> }
  projects: { name: string; tokens: number }[]
}

/** One row of the side pane's Category list. */
export type Category = { name: string; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      live: Live
      tab: Tab
      week: Week | null
      weekBusy: boolean
      categories: Category[]
    }
  }
}
