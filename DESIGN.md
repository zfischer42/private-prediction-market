# Design system — apps/web

Plain CSS, no component framework. This file is the spec: read it before
adding UI, and update it when the system itself changes.

## Brief

A betting slip for a friend group: confident, a little playful, numbers are
the hero. Warm, not sterile — this should never read as a generic dark-mode
SaaS template.

## Tokens

All color, font and radius values live in `apps/web/src/tokens.css`, which
defines the same variable names for dark (default) and
`:root[data-theme="light"]` (light). Nothing outside that file should
declare a raw hex/rgb color, a font stack, or a radius — reference the
variable instead.

| Token | Role |
|---|---|
| `--bg`, `--bg-rgb` | Page background. `-rgb` variant exists so translucent overlays (`rgba(var(--bg-rgb), .85)`) can be built from it. |
| `--surface`, `--field` | Card/panel fill, input fill. |
| `--line`, `--line-strong` | Borders. |
| `--text`, `--muted` | Body text, secondary text. |
| `--accent`, `--accent-fill`, `--accent-soft`, `--accent-rgb` | The one signature color (gold/amber). `-fill` is for solid buttons, `-soft`/`-rgb` for tinted text and translucent backgrounds. |
| `--good`, `--warn`, `--bad` (+ `-rgb`) | Semantic states only — never used decoratively. |
| `--neutral-rgb` | `--muted` as an rgb triple, for translucent chips/bars that aren't accent or semantic. |
| `--radius`, `--radius-sm` | The only two radii in the app. |
| `--font-sans` | Manrope — all UI text. |
| `--font-num` | Space Grotesk — anywhere a number is the point: balances, odds, ranks, badges, codes. Pair with `font-variant-numeric: tabular-nums`. |
| `--space-1`..`--space-6` | Spacing scale (0.25rem base). Prefer these over ad-hoc rem values in new CSS. |

Theme switching: `useTheme()` / `applyStoredTheme()` in `apps/web/src/hooks.ts`
set `data-theme` on `<html>`, persisted to `localStorage`. `applyStoredTheme()`
runs before React mounts so there's no flash of the wrong theme.

Keep `--bg` (both themes), `apps/web/index.html`'s two `theme-color` metas,
and `apps/web/public/manifest.webmanifest`'s `background_color`/`theme_color`
in sync when the palette changes.

## Do

- Reuse an existing class or component in `apps/web/src/ui.tsx` /
  `styles.css` before writing new CSS.
- Use `--font-num` + tabular nums for any value someone is meant to compare
  at a glance (money, odds, counts).
- Keep radii to the two tokens above. Small and uniform is the point — it's
  what stops every card/button/tag from reading as a soft, generic capsule.
- Keep the accent for one signature use at a time (a primary action, an
  active state) — not as general decoration.

## Don't

- No raw hex/rgb color values outside `tokens.css` (or the two intentional
  `#fff` literals for white text on a colored fill, which aren't theme-
  dependent).
- No new font stacks. Two faces, no more.
- No pill-shaped buttons/cards, no glassmorphism/gradient blobs, no emoji as
  icons (see `ThemeIcon` in `App.tsx` for the inline-SVG pattern instead).
- Don't hardcode a light- or dark-only color; use the token so both themes
  stay correct automatically.

## Motion and delight

Purposeful and fast, not decorative — every animation here confirms, guides,
or celebrates something specific. Nothing animates just to move.

| What | How | Where |
|---|---|---|
| A number changes | `Money` / `SignedMoney` / `Percent` from `src/num.tsx` (wraps `@number-flow/react`) instead of the plain `money()`/`percent()` strings from `format.ts`. Use the plain string functions only inside toasts/other non-JSX text. | Balances, odds %, pool totals, payouts, standings |
| A route/tab changes | `motion`/`AnimatePresence` fade-and-lift, ~150-180ms. | `App.tsx` (route), `Circle.tsx` (tab panel) |
| Switching tabs | One `motion.span` with `layoutId="tab-indicator"` slides between tabs, instead of each tab drawing its own underline. | `Circle.tsx` |
| A toast appears/leaves | Spring in `ToastProvider` (`ui.tsx`) via `motion`/`AnimatePresence`. | `ui.tsx` |
| A button/chip is pressed | Pure CSS `:active { transform: scale(0.96) }` - no JS needed for this one. | `.btn`, `.chip` in `styles.css` |
| A bet is placed / a bet wins | `celebrateBet()` / `celebrateWin()` in `src/celebrate.ts` - a small gold `canvas-confetti` burst plus `navigator.vibrate`. Win fires once per bet (tracked in `localStorage`), not on every refetch. These two are the app's only confetti moments - don't add a third without a reason as strong as these. | `BetPanel.tsx`, `BetsList.tsx` |
| A screen's first load | `Skeleton` (`ui.tsx`) instead of a bare "Loading..." string - a card-shaped shimmer placeholder. `Loading` still exists for small in-place refetches, where pretending there's content would be dishonest. | `Market.tsx`, `Circle.tsx` |
| Odds bar fill changes | Plain CSS `transition: width` on `.bar > span`. | `styles.css` |
| Flat color fields | A fixed, `pointer-events: none` SVG-noise overlay at ~5% opacity, `mix-blend-mode: overlay` (`body::before` in `styles.css`). Gives a warm-black/cream surface some grain instead of reading as a flat tinted rectangle. | `styles.css` |

Everything above respects `prefers-reduced-motion`: NumberFlow and the CSS
transitions/keyframes already check it themselves; `celebrate.ts` checks it
explicitly before calling `confetti()` (the vibration alone still fires -
haptic feedback isn't motion).

## Charts

`src/sparkline.tsx` reconstructs odds-over-time client-side from existing bet
rows (no new backend endpoint) and renders it two ways:

- **Home-card sparkline** (`Sparkline`): one line only - the leading option's
  trend - the stat-tile pattern (value + trend), decorative and
  `aria-hidden`. The adjacent `<Percent>` text is already the accessible
  value; the line adds momentum, not new information.
- **Per-market chart** (`OddsHistoryChart`, in `OptionsPanel.tsx`): every
  option, but still "emphasis" color (leader in `--accent`, the field in
  `--muted`) rather than a categorical palette - this app has no validated
  categorical palette, and 2-6 near-identical option lines don't need one.
  Each line is end-labeled with its option name + current `<Percent>` in text
  tokens (never the line's own color, per the usual "text never wears the
  data color" rule); the chart itself is `aria-hidden`, with a `.sr-only`
  paragraph carrying the real text-equivalent (start % -> end % per option).

Both return `null` below two bet events rather than drawing a flat or empty
line - "not enough happened yet" is a sentence, not a chart.

## Next steps (not yet done)

- Extract `apps/web/src/ui.tsx` primitives into `packages/ui` as the shared
  component set (Button, Input, Card, Tabs, Dialog), consuming tokens only.
- Add stylelint (e.g. `stylelint-declaration-strict-value`) to fail CI on a
  raw color/px value outside `tokens.css`, and wire up the currently-stubbed
  `lint` script in `apps/web/package.json`.
- A `/design` route rendering every primitive/state, as a living style guide
  and screenshot target for visual review.
