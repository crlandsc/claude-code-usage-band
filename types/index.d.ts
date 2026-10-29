/** One usage limit as the engine reports it: which, how much is used (0 to 100), when it resets. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The context window: tokens in it, its size, and the share used (0 to 100). */
export type Context = { tokens?: number; window: number; percent?: number }

/** One row of the card's context legend: a /context category, its tokens and theme colour. */
export type BreakdownRow = { name: string; tokens: number; color: string }

/** The /context breakdown boiled down for the card; `compactAt` in tokens, when known. */
export type Breakdown = { rows: BreakdownRow[]; free: number; compactAt?: number }

/** The prompt cache: when the main thread last sent a request, and how long the cache lives. */
export type Cache = { lastAt: number; ttlMs: number }

/** Whether the card is open, and how far it has opened (0 shut, 1 open). */
export type Fold = { open: boolean; t: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      limits: Limit[]
      context: Context | null
      breakdown: Breakdown | null
      cache: Cache | null
      fold: Fold
    }
  }
}
