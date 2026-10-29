// The band's drawings, as SVG strings. A drawing is an image and cannot read
// the app's theme, so each carries a light and a dark palette and follows the
// system's mode through a media query.

import type { Shade } from './colour.ts'
import type { Warmth } from './format.ts'

// Levels and warmth first, then the context categories in the app's own /context colours.
const PALETTE =
  '<style>:root{--muted:#6b6a64;--track:#e6e4de;--ok:#34a560;--hi:#f47230;--crit:#e5484d;--cold:#2f6f95;' +
  '--msg:#247de0;--mcp:#e5693a;--sys:#3fae8c;--prompt:#e8a734;--grey:#8a8a8a;--buf:#c8c8c8}' +
  '@media (prefers-color-scheme: dark){:root{--muted:#a3a19a;--track:#34332f;--ok:#5cb87a;--hi:#e0814f;--crit:#ec6d66;--cold:#74b3cc;' +
  '--msg:#4a8fe8;--mcp:#e0703f;--sys:#4dae92;--prompt:#d99a35;--grey:#9b9b9b;--buf:#5c5c5c}}</style>'

const svg = (w: number, h: number, viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${PALETTE}${body}</svg>`

const R = 5.5
const C = 2 * Math.PI * R

/** A 14 px ring filled clockwise from the top to `percent`, in its shade for each theme. */
export const ring = (percent: number, shade: Shade) => {
  const on = (C * Math.min(Math.max(percent, 0), 100)) / 100

  return svg(
    14,
    14,
    '0 0 14 14',
    `<style>:root{--fill:${shade.light}}@media (prefers-color-scheme: dark){:root{--fill:${shade.dark}}}</style>` +
      `<circle cx="7" cy="7" r="${R}" fill="none" stroke-width="2.2" style="stroke:var(--track)"/>` +
      (on > 0
        ? `<circle cx="7" cy="7" r="${R}" fill="none" stroke-width="2.2" stroke-linecap="round" transform="rotate(-90 7 7)" stroke-dasharray="${on.toFixed(2)} ${C.toFixed(2)}" style="stroke:var(--fill)"/>`
        : ''),
  )
}

/** Every bar's thickness in CSS pixels, whatever its length. */
export const BAR_H = 5

/**
 * A bar with rounded ends: coloured parts laid left to right over the track, each
 * a share (0 to 1) of the whole. Laid out in percentages with no viewBox, so it
 * fills its slot's width at a fixed BAR_H thickness instead of scaling.
 */
export const bar = (parts: { share: number; slot: string }[]) => {
  let x = 0
  const fills = parts
    .map(p => {
      const w = Math.max(0, Math.min(1, p.share)) * 100
      const r = `<rect x="${x.toFixed(2)}%" width="${w.toFixed(2)}%" height="${BAR_H}" style="fill:var(--${p.slot})"/>`
      x += w
      return r
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAR_H}">${PALETTE}` +
    `<clipPath id="ends"><rect width="100%" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>` +
    `<g clip-path="url(#ends)"><rect width="100%" height="${BAR_H}" style="fill:var(--track)"/>${fills}</g></svg>`
  )
}

/** The round-3 chevron: a 10 px stroke, pointing up to open the card, down to shut it. */
export const chevron = (up: boolean) =>
  svg(
    10,
    10,
    '0 0 10 10',
    `<path d="${up ? 'M2 6.5l3-3 3 3' : 'M2 3.5l3 3 3-3'}" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--muted)"/>`,
  )

/** A small rounded square in a palette slot, for the card's legend. */
export const swatch = (slot: string) => svg(8, 8, '0 0 8 8', `<rect width="8" height="8" rx="2" style="fill:var(--${slot})"/>`)

// The robot, one 1×1 square per X: ears, body, eye holes, legs.
const ROBO = ['..X..X..', 'XXXXXXXX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', 'XXXXXXXX', 'X..XX..X']
const BODY = ROBO.map((row, y) =>
  [...row].map((ch, x) => (ch === 'X' ? `M${x} ${y}h1v1h-1z` : '')).join(''),
).join('')

const ROBO_BOX = '-2 -2.5 12 11'
const EASE = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"'

/** The warm robot: bobs and blinks, in green, orange or red as the cache runs down. SMIL, so draw it interactive. */
export const robotWarm = (warmth: Exclude<Warmth, 'cold'>) =>
  svg(
    14,
    13,
    ROBO_BOX,
    '<ellipse cx="4" cy="7.7" rx="3" ry="0.4" fill="#000" opacity="0.25"/>' +
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -0.8;0 0" dur="1.2s" repeatCount="indefinite" ${EASE}/>` +
      `<path d="${BODY}" style="fill:var(--${warmth})"/>` +
      `<g opacity="0"><rect x="1" y="3" width="1" height="1" style="fill:var(--${warmth})"/><rect x="6" y="3" width="1" height="1" style="fill:var(--${warmth})"/>` +
      '<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.91;0.95;1" dur="3.4s" repeatCount="indefinite"/></g></g>',
  )

/** The cold robot: still and blue, a snowflake turning slowly at its shoulder. SMIL, so draw it interactive. */
export const robotCold = () =>
  svg(
    14,
    13,
    ROBO_BOX,
    `<path d="${BODY}" style="fill:var(--cold)"/>` +
      '<g><path d="M7.1 -0.9h3M7.85 -2.2l1.5 2.6M7.85 0.4l1.5 -2.6" fill="none" stroke-width="0.45" stroke-linecap="round" style="stroke:var(--cold)"/>' +
      '<animateTransform attributeName="transform" type="rotate" from="0 8.6 -0.9" to="360 8.6 -0.9" dur="10s" repeatCount="indefinite"/></g>',
  )
