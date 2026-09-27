# Working in this repo

pnpm workspace: `apps/web` (React 19 + Vite PWA), `apps/api`, `packages/*`.

## UI/CSS

Read `DESIGN.md` before touching any styling in `apps/web`. Rules that
matter most:

- Use the tokens in `apps/web/src/tokens.css` — no raw hex/rgb colors, font
  stacks, or radii elsewhere in the app.
- Reuse a component from `apps/web/src/ui.tsx` or an existing class in
  `styles.css` before writing new CSS.
- Numbers that someone compares at a glance (money, odds, ranks) use
  `--font-num` + `tabular-nums`, not the default UI font.
