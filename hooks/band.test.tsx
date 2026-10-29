import type { On, SessionRateLimit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { contrast, ringOf, textOf } from './colour.ts'
import { ease, figuresOf, timeLeft, tok, warmthOf } from './format.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const limit = (kind: string, percentUsed: number, resetsInMs: number): SessionRateLimit => ({
  kind,
  percentUsed,
  resetsAt: new Date(resetsInMs).toISOString(),
})

describe('format', () => {
  test('ramp: green to 60%, then yellow, amber, orange, red fully at 90%', () => {
    expect(ringOf(10)).toEqual({ light: '#34a560', dark: '#5cb87a' })
    expect(ringOf(60)).toEqual({ light: '#34a560', dark: '#5cb87a' })
    expect(ringOf(70)).toEqual({ light: '#e8b100', dark: '#d9c84a' })
    expect(ringOf(90)).toEqual({ light: '#e5484d', dark: '#ec6d66' })
    expect(ringOf(120)).toEqual({ light: '#e5484d', dark: '#ec6d66' })
    expect(ringOf(65).light).not.toBe(ringOf(60).light)
  })

  test('light-mode numbers read at 3:1 on the light band; dark mode keeps its colour', () => {
    for (const p of [0, 65, 70, 75, 80, 85, 90]) {
      const m = textOf(ringOf(p)).match(/^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/)
      expect(m).not.toBeNull()
      expect(contrast(m![1], '#f2f1ed')).toBeGreaterThan(2.95)
      expect(m![2]).toBe(ringOf(p).dark)
    }
  })

  test('cache warmth: green, orange from 10 minutes left, red from 5, then cold', () => {
    const cache = { lastAt: 0, ttlMs: HOUR }
    expect(warmthOf(cache, 18 * MIN)).toEqual({ warmth: 'ok', mins: 42 })
    expect(warmthOf(cache, 50 * MIN)).toEqual({ warmth: 'hi', mins: 10 })
    expect(warmthOf(cache, 55 * MIN)).toEqual({ warmth: 'crit', mins: 5 })
    expect(warmthOf(cache, HOUR)).toEqual({ warmth: 'cold', mins: 0 })
    expect(warmthOf(null, 0)).toBeUndefined()
  })

  test('times and tokens read as before', () => {
    expect(timeLeft(90 * MIN, 0)).toBe('1h30m')
    expect(timeLeft(2 * DAY + 4 * HOUR + 12 * MIN, 0)).toBe('2d4h')
    expect(timeLeft(42 * MIN, 0)).toBe('42m')
    expect(tok(264_000)).toBe('264k')
    expect(tok(1_000_000)).toBe('1M')
  })

  test('figures run 5-hour, weekly, context; a block past its reset reads 0%', () => {
    const figs = figuresOf(
      [
        { kind: 'seven_day', percentUsed: 84, resetsAt: new Date(2 * DAY).toISOString() },
        { kind: 'five_hour', percentUsed: 63, resetsAt: new Date(HOUR).toISOString() },
      ],
      { window: 1e6, percent: 26, tokens: 264_000 },
      2 * HOUR,
    )
    expect(figs.map(f => [f.label, f.percent, f.extra])).toEqual([
      ['5h', 0, ''],
      ['wk', 84, '1d22h'],
      ['ctx', 26, '264k'],
    ])
  })

  test('ease starts and ends at rest', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(Math.abs(ease(0.5) - 0.5)).toBeLessThan(1e-9)
  })
})

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 } },
} as const

const BREAKDOWN = {
  categories: [
    { name: 'Messages', tokens: 191_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 41_000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 18_000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 7_000, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Skills', tokens: 3_000, color: 'warning', isDeferred: false, kind: 'used' },
    { name: 'System prompt', tokens: 3_000, color: 'subtle', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 703_000, color: 'subtle', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 264_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  autocompactSource: 'model-default',
}

// The engine beneath the plugin: usage with a breakdown when asked, a store, commands.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 0 })
  const stored = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: { window: 1e6, percent: 26, tokens: 264_000, ...(e?.breakdown ? { breakdown: BREAKDOWN } : {}) },
      rateLimits: [limit('five_hour', 63, 90 * MIN), limit('seven_day', 84, 2 * DAY + 4 * HOUR)],
    },
  }))
  return clock
}

describe('band', () => {
  test('desktop: rings for 5h, weekly and context, then the cache robot', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60 } as never)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.drawn()
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(5)
    expect((await ui.find({ type: 'Text', text: /63%/ }))?.text).toBe(' 63%')
    expect((await ui.find({ type: 'Text', text: /1h30m/ }))?.text).toBe(' 1h30m')
    expect((await ui.find({ type: 'Text', text: /2d4h/ }))?.text).toBe(' 2d4h')
    expect((await ui.find({ type: 'Text', text: /264k/ }))?.text).toBe(' 264k')
    expect((await ui.find({ type: 'Text', text: /42m/ }))?.text).toBe(' 42m')
    expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeUndefined()
    await ui.unmount()
  })

  test('with anim on, the chevron grows the card over a quarter second, then shrinks it back', async ($, on) => {
    const clock = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ kind: 'plugin', name: 'usage-band', command: 'usage-band', args: 'anim on' } as never)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

    await ui.press({ key: 'usage-band-fold' })
    await clock.advance(112)
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()

    await clock.advance(200)
    await ui.drawn()
    expect((await ui.find({ type: 'Text', text: /auto-compacts/ }))?.text).toBe(' · auto-compacts at 967k')
    expect((await ui.find({ type: 'Text', text: /Messages/ }))?.text).toBe(' Messages ')
    expect(await ui.find({ type: 'Button' })).toBeDefined()
    // Three rings, the chevron, the context bar, five legend swatches (no cache yet).
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(10)

    await ui.press({ key: 'usage-band-fold' })
    await clock.advance(300)
    expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button' })).toBeDefined()
    await ui.unmount()
  })

  test('by default the card opens at once', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'usage-band-fold' })
    expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()
    await ui.unmount()
  })

  test('/usage-band demo on shows one figure of each colour', async ($, on) => {
    engine(on)
    on('ui.invalidate', () => ({ value: undefined }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ kind: 'plugin', name: 'usage-band', command: 'usage-band', args: 'demo on' } as never)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /93%/ }))?.text).toBe(' 93%')
    expect((await ui.find({ type: 'Text', text: /31%/ }))?.text).toBe(' 31%')
    expect((await ui.find({ type: 'Text', text: /70%/ }))?.text).toBe(' 70%')
    expect((await ui.find({ type: 'Text', text: /42m/ }))?.text).toBe(' 42m')
    await ui.unmount()
    await $.command.run({ kind: 'plugin', name: 'usage-band', command: 'usage-band', args: 'demo off' } as never)
  })

  test('terminal: the same facts as text', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.drawn()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /84%/ }))?.text).toBe('84%')
    await ui.unmount()
  })
})
