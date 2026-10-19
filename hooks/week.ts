// The week: folds the scanner's token sums into money and three lessons. Pure.

import type { Tokens, Week } from '../types'
import { rewriteUsd, sumTokens, tokensUsd } from './prices'
import { money, tok } from './moves'

export type WeekSummary = {
  tokens: number
  usd: number
  subTokens: number
  subUsd: number
  readShare: number
  coldUsd: number
  lessons: string[]
}

function fold(byModel: Record<string, Tokens>) {
  let tokens = 0, usd = 0, read = 0, input = 0
  for (const [model, t] of Object.entries(byModel)) {
    tokens += sumTokens(t)
    usd += tokensUsd(t, model)
    read += t.read
    input += t.input + t.read + t.write5m + t.write1h
  }
  return { tokens, usd, read, input }
}

export function summarize(w: Week): WeekSummary {
  const main = fold(w.main)
  const sub = fold(w.sub)
  const tokens = main.tokens + sub.tokens
  const usd = main.usd + sub.usd
  const input = main.input + sub.input
  const readShare = input ? (main.read + sub.read) / input : 0
  let coldUsd = 0
  for (const [model, n] of Object.entries(w.cold.byModel)) coldUsd += rewriteUsd(n, model)

  const lessons: string[] = []
  const subShare = usd ? sub.usd / usd : 0
  if (subShare >= 0.3) {
    const types = Object.entries(w.agentTypes).sort((a, b) => b[1].tokens - a[1].tokens)
    const top = types[0]
    const per = top ? top[1].tokens / Math.max(1, top[1].runs) : 0
    lessons.push(`Subagents spent ${Math.round(subShare * 100)}% (${money(sub.usd)}).` +
      (top ? ` ${top[0]} ran ${top[1].runs} times at ${tok(per)} each: give searches to Explore and keep briefs narrow.` : ''))
  }
  if (w.cold.count >= 10) {
    lessons.push(`${w.cold.count} times the cache had expired and a context over 100k was sent again (${money(coldUsd)}). Compact before breaks longer than an hour.`)
  }
  if (readShare >= 0.9) lessons.push(`${Math.round(readShare * 100)}% of input was read from the cache. Keep doing this.`)
  else lessons.push(`Only ${Math.round(readShare * 100)}% of input came from the cache: long pauses and model switches start it over.`)

  return { tokens, usd, subTokens: sub.tokens, subUsd: sub.usd, readShare, coldUsd, lessons }
}
