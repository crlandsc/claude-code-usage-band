// The green-to-red ramp, tuned with Chris on the ramp tuner (2026-10-29, "Bright light").
// Each stop is where its colour fully arrives; between stops the colour blends in OKLCH,
// so the in-between shades stay clean. Light mode rings use bright colours; light mode
// numbers are the same hue darkened to 3:1 on the light band. Dark mode uses one colour
// for both.

import type { Warmth } from './format.ts'

/** A colour for each theme. */
export type Shade = { light: string; dark: string }

const STOPS: { at: number; light: string; dark: string }[] = [
  { at: 60, light: '#34a560', dark: '#5cb87a' }, // green
  { at: 70, light: '#e8b100', dark: '#d9c84a' }, // yellow
  { at: 80, light: '#f2a503', dark: '#e2a93b' }, // amber
  { at: 85, light: '#f47230', dark: '#e0814f' }, // orange
  { at: 90, light: '#e5484d', dark: '#ec6d66' }, // red
]

const COLD: Shade = { light: '#2f6f95', dark: '#74b3cc' }
/** The light band, for measuring contrast. */
const LIGHT_BAND = '#f2f1ed'

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const l2s = (c: number) => {
  const v = Math.max(0, Math.min(1, c))
  return Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) * 255)
}
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

const toOklch = (hex: string): [number, number, number] => {
  const [r, g, b] = channels(hex).map(s2l)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)]
}

const fromOklch = ([L, C, H]: [number, number, number]) => {
  const A = C * Math.cos(H)
  const B = C * Math.sin(H)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]

  return `#${rgb.map(c => l2s(c).toString(16).padStart(2, '0')).join('')}`
}

const mix = (a: string, b: string, t: number) => {
  const [L1, C1, H1] = toOklch(a)
  const [L2, C2, H2] = toOklch(b)
  let dh = H2 - H1
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI

  return fromOklch([L1 + (L2 - L1) * t, C1 + (C2 - C1) * t, H1 + dh * t])
}

const luminance = (hex: string) =>
  channels(hex).map(s2l).reduce((y, c, i) => y + c * [0.2126, 0.7152, 0.0722][i], 0)

export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// Darkens a light-mode colour, keeping its hue, until it reads at 3:1 on the light band.
const deepen = (hex: string) => {
  let [L, C, H] = toOklch(hex)
  let out = hex
  while (contrast(out, LIGHT_BAND) < 3 && L > 0.2) {
    L -= 0.005
    out = fromOklch([L, C, H])
  }

  return out
}

/** The ring colour at a percent: the first stop's below it, the last's past it, blended between. */
export const ringOf = (percent: number): Shade => {
  const p = Math.min(Math.max(percent, 0), 100)
  if (p <= STOPS[0].at) return { light: STOPS[0].light, dark: STOPS[0].dark }
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, b] = [STOPS[i], STOPS[i + 1]]
    if (p < b.at) {
      const t = (p - a.at) / (b.at - a.at)
      return { light: mix(a.light, b.light, t), dark: mix(a.dark, b.dark, t) }
    }
  }
  const last = STOPS[STOPS.length - 1]

  return { light: last.light, dark: last.dark }
}

/** A text colour that follows the app's theme: the deepened light shade, or the dark one. */
export const textOf = (shade: Shade) => `light-dark(${deepen(shade.light)}, ${shade.dark})`

/** The cache's colours: green while warm, orange in its last 10 minutes, red in its last 5, then blue. */
export const warmthShade = (w: Warmth): Shade =>
  w === 'cold' ? COLD : ringOf(w === 'ok' ? 0 : w === 'hi' ? 85 : 100)

/** The terminal draws no blended colours: theme keys in four steps. */
export const termKey = (percent: number) =>
  percent >= 90 ? 'error' : percent >= 85 ? 'claude' : percent >= 70 ? 'warning' : 'success'
