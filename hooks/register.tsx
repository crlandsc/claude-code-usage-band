import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { Breakdown, Cache, Context, Fold, Limit } from '../types'
import { bar, chevron, ring, robotCold, robotWarm, swatch } from './art.ts'
import { ringOf, termKey, textOf, warmthShade } from './colour.ts'
import { CACHE_TTL, ease, figuresOf, pct, timeLeft, tok, warmthOf } from './format.ts'

// A band above the prompt: rings for the 5-hour limit, the weekly limit and
// context, then a robot for the prompt cache. The chevron grows a card up out
// of the row with the context breakdown and the cache's details.

const COMMAND = 'usage-band'
const FOLD_KEY = 'usage-band-fold'
/** Rows the card grows to while it opens; once open it takes its own height. */
const CARD_ROWS = 4
const OPEN_MS = 240
const FRAME_MS = 16
/** Pixels per cell the bars are drawn at; they scale down to fit. */
const CELL_PX = 12
// Wide enough for "CACHE warm cold in 59m" on one line at footnote size.
const CACHE_COLS = 36

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [] as Limit[])
const context = atom({ plugin: 'usage-band', key: 'context' } as const, null as Context | null)
const breakdown = atom({ plugin: 'usage-band', key: 'breakdown' } as const, null as Breakdown | null)
const cache = atom({ plugin: 'usage-band', key: 'cache' } as const, null as Cache | null)
const fold = atom({ plugin: 'usage-band', key: 'fold' } as const, { open: false, t: 0 } as Fold)

let motion: Timer | undefined
// Whether the card glides open (`on`) or appears at once (`off`, the default: the
// band redraws in steps, so the glide stutters), set by /usage-band anim.
let glide = false
// Fixed sample figures for screenshots, set by /usage-band demo; never kept across reloads.
let demo = false

const MIN = 60_000
const at = (now: number, ms: number) => new Date(now + ms).toISOString()
// One of each colour: the 5-hour limit near its end (red), the week early (green), context at 70% (yellow), a warm cache.
const DEMO = {
  limits: (now: number): Limit[] => [
    { kind: 'five_hour', percentUsed: 93, resetsAt: at(now, 42 * MIN) },
    { kind: 'seven_day', percentUsed: 31, resetsAt: at(now, (4 * 24 + 8) * 60 * MIN) },
  ],
  context: { tokens: 702_000, window: 1_000_000, percent: 70 } as Context,
  cache: (now: number): Cache => ({ lastAt: now - 18 * MIN, ttlMs: CACHE_TTL }),
  breakdown: {
    rows: [
      { name: 'Messages', tokens: 612_000, color: 'msg' },
      { name: 'MCP tools', tokens: 32_000, color: 'mcp' },
      { name: 'System tools', tokens: 31_000, color: 'sys' },
      { name: 'System prompt', tokens: 11_000, color: 'prompt' },
      { name: 'Other', tokens: 16_000, color: 'grey' },
    ],
    free: 265_000,
    compactAt: 967_000,
  } as Breakdown,
}

const keepLimits = (list: readonly SessionRateLimit[]): Limit[] =>
  list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))

const keepContext = (c: SessionContextUsage): Context => ({ tokens: c.tokens, window: c.window, percent: c.percent })

// The app's /context colours by category name (palette slots in art.ts).
const SLOT: Record<string, string> = { Messages: 'msg', 'MCP tools': 'mcp', 'System tools': 'sys', 'System prompt': 'prompt' }

// The /context breakdown, boiled down: the four biggest categories, the rest as Other, and what is free.
const measureBreakdown = async ($: EngineInterface) => {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (!b) return
  const sum = (kind: string) => b.categories.filter(c => c.kind === kind).reduce((n, c) => n + c.tokens, 0)
  const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((x, y) => y.tokens - x.tokens)
  // Colours mirror the app's /context panel by category; the rest are grey.
  const rows = used.slice(0, 4).map(c => ({ name: c.name, tokens: c.tokens, color: SLOT[c.name] ?? 'grey' }))
  const rest = used.slice(4).reduce((n, c) => n + c.tokens, 0)
  if (rest > 0) rows.push({ name: 'Other', tokens: rest, color: 'grey' })
  const buffer = sum('buffer')

  await update($, breakdown, () => ({ rows, free: sum('free'), compactAt: buffer > 0 ? b.rawMaxTokens - buffer : undefined }))
}

// Opens or shuts the card, stepping its height each frame unless gliding is off.
const toggle = async ($: EngineInterface) => {
  const now = await read($, fold)
  const from = now.t
  const open = !now.open
  if (open) void measureBreakdown($)
  motion?.cancel()
  motion = undefined
  if (!glide) {
    await update($, fold, () => ({ open, t: open ? 1 : 0 }))
    return
  }
  const to = open ? 1 : 0
  const span = OPEN_MS * Math.abs(to - from)
  const start = await $.clock.now()
  await update($, fold, () => ({ open, t: from }))
  motion = $.clock.every(FRAME_MS, async () => {
    const done = span === 0 ? 1 : Math.min(1, ((await $.clock.now()) - start) / span)
    await update($, fold, f => ({ ...f, t: from + (to - from) * done }))
    if (done === 1) {
      motion?.cancel()
      motion = undefined
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Usage band: anim on|off sets whether the card glides open',
      argumentHint: '[anim on|off]',
      immediate: true,
    })
    glide = (await $.store.get('glide')) === true
    const u = await $.session.usage()
    await update($, limits, () => keepLimits(u.rateLimits))
    await update($, context, () => keepContext(u.context))
    // Redraw each minute so times left and the cache's warmth stay current.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [what, value] = e.args.trim().split(/\s+/)
    if (what === 'demo' && (value === 'on' || value === 'off')) {
      demo = value === 'on'
      await $.ui.invalidate('ui.render')
      return { text: `Demo figures ${value}.` }
    }
    if (what !== 'anim' || (value !== 'on' && value !== 'off')) {
      return { text: `Card animation is ${glide ? 'on' : 'off'}. Use /usage-band anim on or /usage-band anim off.` }
    }
    glide = value === 'on'
    await $.store.set('glide', glide)

    return { text: `Card animation ${value}.` }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => keepLimits(e.rateLimits))
    if (e.changed.includes('context')) {
      await update($, context, () => keepContext(e.context))
      if ((await read($, fold)).open) void measureBreakdown($)
    }

    return next(e)
  })

  // A cleared or compacted session starts a new cache; a resumed one knows how long it was away.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, breakdown, () => null)
    } else if (typeof e.seconds_since_last_response === 'number') {
      const lastAt = (await $.clock.now()) - e.seconds_since_last_response * 1000
      await update($, cache, c => ({ lastAt, ttlMs: c?.ttlMs ?? CACHE_TTL }))
    }

    return result
  }).catch(($, e, next) => next(e))

  // Each main-thread request reads or writes the cache, so its start restarts the clock.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const lastAt = await $.clock.now()
      await update($, cache, c => ({ lastAt, ttlMs: c?.ttlMs ?? CACHE_TTL }))
    }
    yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const now = await $.clock.now()
    const ls = demo ? DEMO.limits(now) : await read($, limits)
    const ctx = demo ? DEMO.context : await read($, context)
    if (ls.length === 0 && !ctx) return next(e)

    const figs = figuresOf(ls, ctx, now)
    const c = demo ? DEMO.cache(now) : await read($, cache)
    const w = warmthOf(c, now)
    const cacheText = w ? (w.warmth === 'cold' ? 'cold' : `${w.mins}m`) : ''

    // The terminal draws no Svg: the same facts as one line of text.
    if (e.surface === 'terminal' || !('Svg' in ui)) {
      return (
        <Box flexDirection="row" flexWrap="wrap" paddingLeft={1}>
          {figs.map(f => (
            <Box key={f.label} flexDirection="row" marginRight={2}>
              <Text dimColor>{f.label} </Text>
              <Text color={termKey(f.percent ?? 0)} bold>{pct(f.percent)}</Text>
              {f.extra ? <Text dimColor> {f.extra}</Text> : null}
            </Box>
          ))}
          {w ? (
            <Box key="cache" flexDirection="row">
              <Text dimColor>cache </Text>
              <Text color={w.warmth === 'cold' ? 'suggestion' : termKey(w.warmth === 'ok' ? 0 : w.warmth === 'hi' ? 85 : 100)} bold>{cacheText}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    const { Svg } = ui
    const f = await read($, fold)

    const row = (
      <Box key="row" flexDirection="row" alignItems="center" paddingLeft={1}>
        <Box flexGrow={1} flexDirection="row" flexWrap="wrap" alignItems="center">
          {figs.map(g => (
            <Box key={g.label} flexDirection="row" alignItems="center" marginRight={2}>
              <Text size="footnote" color="inactive">{g.label} </Text>
              <Svg source={ring(g.percent ?? 0, ringOf(g.percent ?? 0))} alt={`${g.name} ${pct(g.percent)} used`} width={14} height={14} />
              <Text size="footnote" weight="semibold" color={textOf(ringOf(g.percent ?? 0))}> {pct(g.percent)}</Text>
              {g.extra ? <Text size="footnote" color="inactive"> {g.extra}</Text> : null}
            </Box>
          ))}
          {w ? (
            <Box key="cache" flexDirection="row" alignItems="center">
              <Svg
                source={w.warmth === 'cold' ? robotCold() : robotWarm(w.warmth)}
                alt={w.warmth === 'cold' ? 'Prompt cache cold' : `Prompt cache warm, ${w.mins} minutes left`}
                width={14}
                height={13}
                isInteractive
              />
              <Text size="footnote" weight="semibold" color={textOf(warmthShade(w.warmth))}> {cacheText}</Text>
            </Box>
          ) : null}
        </Box>
        {/* A Button cannot hold a drawing, so a blank Button lies over the chevron and takes the press. */}
        <Box position="relative" width={3} height={1} alignItems="center" justifyContent="center">
          <Svg source={chevron(!f.open)} alt={f.open ? 'Hide details' : 'Show details'} width={10} height={10} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
            <Button key={FOLD_KEY} plain label="   " onPress={() => void toggle($)} />
          </Box>
        </Box>
      </Box>
    )

    if (f.t <= 0) return row

    const b = demo ? DEMO.breakdown : await read($, breakdown)
    const window = ctx?.window ?? 0
    const ctxFig = figs[figs.length - 1]
    const ago = c ? (now - c.lastAt < 60_000 ? 'just now' : `${timeLeft(now, c.lastAt)} ago`) : ''
    const barPx = Math.max(240, e.props.bodyColumns * CELL_PX)
    // Used categories from the left, the auto-compact buffer at the right end, as /context draws it.
    const used = (b?.rows ?? []).map(r => ({ share: window > 0 ? r.tokens / window : 0, slot: r.color }))
    const buffer = b?.compactAt && window > 0 ? Math.max(0, window - b.compactAt) / window : 0
    const parts = [...used, { share: Math.max(0, 1 - buffer - used.reduce((n, u) => n + u.share, 0)), slot: 'track' }, { share: buffer, slot: 'buf' }]
    const left = w && c ? Math.max(0, (c.lastAt + c.ttlMs - now) / c.ttlMs) : 0

    const body = (
      <Box flexDirection="row" paddingX={1} paddingTop={0.5} paddingBottom={0.5}>
        <Box flexGrow={1} flexDirection="column" marginRight={2}>
          <Box flexDirection="row">
            <Text size="caption" weight="semibold" color="inactive">CONTEXT  </Text>
            <Text size="footnote">{ctx?.tokens ? `${tok(ctx.tokens)} of ${tok(window)} ` : ''}</Text>
            <Text size="footnote" weight="semibold" color={textOf(ringOf(ctxFig.percent ?? 0))}>{pct(ctxFig.percent)}</Text>
            {b?.compactAt ? <Text size="footnote" color="inactive"> · auto-compacts at {tok(b.compactAt)}</Text> : null}
          </Box>
          <Box flexDirection="row" marginTop={0.25} marginBottom={0.25}>
            <Svg source={bar(parts, barPx)} alt={`Context ${pct(ctxFig.percent)} used, by category`} />
          </Box>
          <Box flexDirection="row" flexWrap="wrap">
            {(b?.rows ?? []).map(r => (
              <Box key={r.name} flexDirection="row" alignItems="center" marginRight={2}>
                <Svg source={swatch(r.color)} alt={r.name} width={8} height={8} />
                <Text size="footnote" color="inactive"> {r.name} </Text>
                <Text size="footnote">{tok(r.tokens)}</Text>
              </Box>
            ))}
            {b ? (
              <Box key="free" flexDirection="row">
                <Text size="footnote" color="inactive">Free </Text>
                <Text size="footnote">{tok(b.free)}</Text>
              </Box>
            ) : (
              <Text size="footnote" color="inactive">Measuring…</Text>
            )}
          </Box>
        </Box>
        {w && c ? (
          <Box width={CACHE_COLS} flexShrink={0} flexDirection="column">
            <Box flexDirection="row">
              <Text size="caption" weight="semibold" color="inactive">CACHE  </Text>
              <Text size="footnote" weight="semibold" color={textOf(warmthShade(w.warmth))}>{w.warmth === 'cold' ? 'cold' : 'warm'}</Text>
              {w.warmth === 'cold' ? null : <Text size="footnote" color="inactive"> cold in {w.mins}m</Text>}
            </Box>
            <Box flexDirection="row" marginTop={0.25} marginBottom={0.25}>
              <Svg source={bar([{ share: left, slot: w.warmth }], CACHE_COLS * CELL_PX)} alt={`Cache, ${Math.round(left * 100)}% of the hour left`} />
            </Box>
            <Text size="footnote" color="inactive">last reply {ago}{ctx?.tokens ? ` · ${tok(ctx.tokens)} cached` : ''}</Text>
          </Box>
        ) : null}
      </Box>
    )

    // While it moves, the card is a window CARD_ROWS high at most, held to the row's edge.
    const card =
      f.t >= 1 ? (
        <Box key="card" flexDirection="column">{body}</Box>
      ) : (
        <Box key="card" flexDirection="column" justifyContent="flex-end" overflow="hidden" height={CARD_ROWS * ease(f.t)}>
          {body}
        </Box>
      )

    return (
      <Box flexDirection="column">
        {card}
        {row}
      </Box>
    )
  })
}
