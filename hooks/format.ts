import type { Cache, Context, Limit } from '../types'

const MIN = 60_000
const HOUR = 60 * MIN

/** How warm the prompt cache is: green, orange under 10 minutes, red under 5, then cold. */
export type Warmth = 'ok' | 'hi' | 'crit' | 'cold'

export const timeLeft = (at: number, now: number) => {
  const mins = Math.max(0, Math.round((at - now) / MIN))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60

  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

export const tok = (n: number) => (n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1000)}k`)

/** One figure of the row: a ring, its percent, and the faint time or tokens after it. */
export type Figure = { label: string; name: string; percent?: number; extra: string }

const LIMITS = [
  { kind: 'five_hour', label: '5h', name: '5-hour limit' },
  { kind: 'seven_day', label: 'wk', name: 'Weekly limit' },
] as const

// A limit past its reset reads 0% until a response reports the new block.
const limitFigure = (l: Limit, label: string, name: string, now: number): Figure => {
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!Number.isNaN(at) && now >= at) return { label, name, percent: 0, extra: '' }

  return { label, name, percent: l.percentUsed, extra: Number.isNaN(at) ? '' : timeLeft(at, now) }
}

/** The row's figures in order: 5-hour, weekly, context. A limit the engine has not reported is left out. */
export const figuresOf = (limits: Limit[], context: Context | null, now: number): Figure[] => {
  const out: Figure[] = []
  for (const { kind, label, name } of LIMITS) {
    const l = limits.find(x => x.kind === kind)
    if (l) out.push(limitFigure(l, label, name, now))
  }
  const p = context?.percent
  out.push({ label: 'ctx', name: 'Context', percent: p, extra: context?.tokens ? tok(context.tokens) : '' })

  return out
}

export const pct = (percent?: number) => (percent === undefined ? '–' : `${Math.round(percent)}%`)

/** The cache's warmth and minutes left, or undefined before the first request. */
export const warmthOf = (cache: Cache | null, now: number): { warmth: Warmth; mins: number } | undefined => {
  if (!cache) return undefined
  const left = cache.lastAt + cache.ttlMs - now
  if (left <= 0) return { warmth: 'cold', mins: 0 }
  const mins = Math.ceil(left / MIN)

  return { warmth: mins <= 5 ? 'crit' : mins <= 10 ? 'hi' : 'ok', mins }
}

export const CACHE_TTL = HOUR

/** Smooth in and out, so the card eases at both ends of its travel. */
export const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
