# UI next steps

Where the Kalshi-style redesign (`ui/kalshi-redesign`) left off, and what to do next.

## Run it

```bash
pnpm install
cd sandbox && npm install && cd ..
npm --prefix sandbox run demo      # http://localhost:5175
```

The demo runs the real app against an in-browser Postgres with the real schema and RLS,
seeded with three users (Alice, Bob, Cara - switch at the bottom of the screen). No
Supabase project or login needed. First load takes a while; a reload resets the data.

`pnpm dev` (port 5173) runs against the real Supabase project in `apps/web/.env`, but
Google sign-in there redirects to the production URL unless `http://localhost:5173/**` is
added under Supabase -> Authentication -> URL Configuration -> Redirect URLs.

## What this branch changed

- **Design tokens** (`apps/web/src/styles.css`, `:root`): true black background, solid dark
  cards, green `--accent` that doubles as `--yes`, red `--no`, SF system font, tabular numbers.
- **Sign-in**: no card; full-screen layout, white Google button pinned to the bottom.
- **Market cards** (`screens/circle/MarketsTab.tsx`): chance on the right, green/red Yes/No
  sides on binary and over/under markets, top 3 outcomes with bars on multiple-choice ones.
  Odds for the whole list come from one query (`getOddsForMarkets` in `lib/markets.ts`).
- **Market page**: headline chance, then a trade-ticket bet panel
  (`screens/market/BetPanel.tsx`): pick a side, big dollar field, payout/profit estimate,
  a button that names the bet ("Bet $25 on No").
- **Install flow** (`src/install.tsx`): a slim "Get the app" bar opens a sheet with the real
  iOS steps (Share -> View More -> Add to Home Screen -> Add). Handles Chrome/Firefox on iOS,
  in-app browsers (Instagram, Snapchat...) and a one-tap Install on Android/desktop Chrome.
- **Shell**: top bar is logo + bell; Sign out lives at the bottom of the Circles screen;
  circle Settings moved behind a gear so the tab row fits a phone.
- **Icons**: recolored to the green `$`; iOS launch screens in `public/splash/`.

`sideOf(kind, index)` in `format.ts` is the single place that decides which option is the
"yes" (green) or "no" (red) side. Use it anywhere options are colored.

## iOS rules this codebase follows

Keep these when adding UI - each one fixes a bug that showed up on a real iPhone.

- Inputs are at least 16px, or iOS zooms the page on focus.
- Anything under the status bar or home indicator pads with `env(safe-area-inset-*)`.
- Hover styles go inside the `@media (hover: hover)` block at the end of `styles.css`, or a
  tapped button stays highlighted.
- New interactive elements get `touch-action: manipulation` (see the `a, button, .btn...`
  rule) to kill the double-tap zoom delay.
- Use `100dvh`, not `100vh`, for full-height screens (Safari's toolbar changes height).
- `index.html` paints the background black inline and ships `apple-touch-startup-image`s,
  so an installed launch never flashes white. If a new iPhone size ships, add its launch
  image (`public/splash/<w>x<h>.png`, black with the icon centered) and a matching `<link>`.
- Service-worker registration can't be tested in embedded/automated browsers; check a
  real deploy in Safari.

## Backlog, in priority order

1. **Price history chart on the market page.** The most recognisable Kalshi element.
   Derivable client-side: replay `getMarketBets()` in `created_at` order and plot each
   option's share of the pot. Small inline SVG, no chart library needed.
2. **Sticky bet button.** On the market page, pin the ticket's CTA to the bottom of the
   screen (with `env(safe-area-inset-bottom)`) so it's reachable without scrolling.
3. **Bottom tab bar** (Home / Alerts / Profile) when running installed, so it feels native.
   Only show it in `display-mode: standalone`.
4. **Restyle the remaining screens.** Standings, Chat, Members, New market and the
   resolution flow picked up the new tokens but kept their old structure:
   - Standings: rank, avatar tile, name, net profit in green/red, like a leaderboard.
   - Chat: message bubbles, yours right-aligned, sticky composer above the keyboard.
   - New market: step-by-step (question -> type -> options -> timing) instead of one long form.
   - Resolution: one clear "Report result" button that opens a sheet.
5. **Market images.** `markets.image_url` already exists; show it as a small square on cards
   and a banner on the market page.
6. **Loading skeletons** instead of the "Loading..." text on list screens.
7. **Motion.** Animate odds bars and the chance number when they change (they update live).
8. **Light mode.** Kalshi's default is light; the tokens are ready for a
   `prefers-color-scheme: light` override if wanted.

## Known gaps

- Vercel builds `apps/web` with `npm install --legacy-peer-deps` (`apps/web/vercel.json`):
  pnpm's registry client fails on Vercel's build image, and `@vitejs/plugin-react` doesn't
  list vite 8 as a supported peer yet. Revisit when either is fixed upstream.
- Vercel is not auto-deploying from GitHub yet: the project is still connected to the old
  `YoyoyorkLi/private-prediction-market` repo. Reconnect it to
  `zfischer42/private-prediction-market` in Vercel -> Settings -> Git.
