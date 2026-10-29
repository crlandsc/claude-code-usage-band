# Usage band – design notes

Why the band looks and behaves as it does, and what the Claude Code desktop app allows a mod to draw. The README covers what it is.

## Row

`5h ◔ 63% 1h30m · wk ◕ 84% 2d4h · ctx ◔ 26% 264k · 🤖 42m  ⌃`

- Rings (14 px drawings), a bold percent, then the time left (always) or the context tokens, faint.
- Order: 5-hour, weekly, context, cache. Context is measured against the full window; the auto-compact point is in the card.
- Colour (`hooks/colour.ts`): green to 60%, then a smooth OKLCH blend through yellow (70), amber (80) and orange (85) to red at 90%. Light-mode rings are bright (the app's own `#F2A503` and `#F47230` among them); dark mode uses softer shades of the same hues.
- Cache: a bobbing, blinking robot, green while warm, orange in the last 10 minutes, red in the last 5, then a still blue robot with a turning snowflake. The cache is assumed to live an hour from the last main-thread request.
- Times: `4h53m`, `53m`, `4d2h`.
- Narrow windows: whole figures wrap to a second line; the chevron stays right.
- Terminal: the same facts as one line of text.

## Card

The chevron opens a card above the row, so the row never moves. Context on the left: tokens of the window, percent, the auto-compact point, a bar and a legend in the colours of the app's own /context panel (Messages blue, MCP tools orange, System tools teal, System prompt amber, the rest grey), with the auto-compact buffer at the bar's right end. Cache on the right: warm or cold, time left, a bar of the hour left, last reply, tokens cached.

The card opens and shuts at once. `/usage-band anim on` steps its height every 16 ms over 240 ms instead; it reads as choppy, because the band redraws whole each step.

## What the desktop band takes

Checked with `claude plugin test` and in the app (October 2026).

- A Button cannot hold a drawing. The chevron is a drawing with a blank Button laid over it, both centred in one 3×1 box.
- Box `height` and `width`: a number (rows or cells, fractions allowed) or a whole-number percentage. `"40px"` and `"19.1%"` are refused.
- `Text` takes `size` (`caption`, `footnote`, `body`), `weight` and theme-key colours. A `light-dark(...)` colour validates but the app draws the text plain, so the percents follow the theme's text colour and the rings carry the colour.
- A drawing animated with SMIL needs `isInteractive`. Making every drawing interactive for `<title>` tooltips stretched the bars and showed no tooltips, so only the robot is interactive.
- Drawings cannot read the app's theme; each carries a light and a dark palette and follows the system's mode.
