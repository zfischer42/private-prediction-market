---
title: Private Prediction Market Scaffold Plan
status: final
created: 2026-08-02
updated: 2026-08-02
---

# Scaffold Plan

This handoff turns the architecture spine into an initial repo layout and build order for PM, dev, and future contributors.

## Repo Layout

```text
apps/
  web/        React + Vite + Tailwind PWA
  api/        Fastify API with domain services and auth verification
packages/
  ui/         shared component primitives
  config/     shared TS, lint, Tailwind, and build configuration
  types/      shared contracts and generated Supabase types
supabase/
  migrations/ schema migrations
  seed/       local seed data
  policies/   access policies and RLS definitions
```

## Build Order

1. Create the workspace shell and package manager wiring.
2. Add shared config packages before implementing features.
3. Scaffold the Fastify API with a health endpoint and auth verification.
4. Scaffold the web app with the PWA shell, layout, and installability hooks.
5. Add Supabase migrations, policies, and generated types.
6. Wire the web app to the API for authenticated app flows.
7. Implement the first vertical slice: create a private space and join it by invite.

## Local Developer Loop

- `pnpm install` to bootstrap the workspace.
- `pnpm dev` to run the web and API apps together.
- `pnpm lint` to check shared rules.
- `pnpm typecheck` to verify package boundaries and generated types.
- `pnpm test` for any API or shared unit tests added later.

## Scaffold Decisions

- Keep browser-only code inside `apps/web`.
- Keep database access and permission checks inside `apps/api`.
- Generate shared API/domain contracts into `packages/types`.
- Keep shared UI components free of app-specific data access.
- Use the Supabase project as the persisted source of truth rather than a separate local database layer.

## Definition of Ready for Implementation

- The workspace can be installed and run locally.
- The repo boundary is obvious from the folder structure.
- The app shell loads on mobile.
- Auth, spaces, and invites have a clear path through the API.
- Supabase migrations and generated types are part of the development loop.
