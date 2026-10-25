/** A rate-limit window as Claude reports it: `five_hour`, `seven_day`, or a gateway's. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of a usage limit, for the pace. */
export type LimitSample = { at: number; pct: number }

/** A step Claude failed on, in a row: the same command or file. */
export type Loop = { key: string; label: string; count: number; usdAtFirst: number; isTold: boolean }

/** What one compaction saved, in list-price dollars: kept 7 days in the store. */
export type Saving = { id: string; at: number; kind: 'idle' | 'button'; usd: number }

/** A compaction whose saving is still being counted. */
export type SavingRun = {
  id: string
  kind: 'idle' | 'button'
  /** Dollars so far; the compaction's own cost counts against it. */
  usd: number
  /** What each later request saves (button), or 0 when the saving comes at once (idle). */
  perRequest: number
  /** Idle only: the cache would have expired here; a return before it saved nothing. */
  expiresAt?: number
}

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
  /** Main-loop requests it made. */
  requests?: number
  /** The first words of your request; absent when the turn continued without one. */
  prompt?: string
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
  /** When the session began, in `$.clock.now()` milliseconds: the session's start. */
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
  /** Recent readings of each usage limit, by kind. */
  limitSamples?: Record<string, LimitSample[]>
  /** Forecasts already said, as `kind@resetsAt`. */
  toldPace?: string[]
  /** The step Claude is failing on, while the failures run. */
  loop?: Loop | null
  /** The compaction whose saving is being counted. */
  savingRun?: SavingRun | null
}

export type Tab = 'suggestions' | 'context' | 'session' | 'week' | 'insights'

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
  /** The 7 days before: tokens by model. */
  prev?: { main: Record<string, Tokens>; sub: Record<string, Tokens> }
  /** Tokens by model for the top projects, this week and the one before. */
  byProject?: Record<string, { cur: Record<string, Tokens>; prev: Record<string, Tokens> }>
  /** Today since midnight, all sessions: tokens by model. */
  today?: Record<string, Tokens>
  /** This session's cost when the scanner ran: what today adds on top. */
  sessionUsdAtScan?: number
}

/** One row of the side pane's Category list. */
export type Category = { name: string; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-coach': {
      live: Live
      tab: Tab
      week: Week | null
      weekBusy: boolean
      categories: Category[]
      saved: { usd: number; count: number }
      isWelcome: boolean
    }
  }
}
