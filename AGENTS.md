# AGENTS.md

## Project overview

**Startup Machine** (https://startupmachine.ai) is an AI startup builder. Founders provide a one-line idea, a domain, or a repo; a fleet of specialized AI agents (orchestrated by a CEO agent via the Claude Agent SDK) researches competitors, sizes the market, drafts a pitch deck, and delivers a decision-ready founder brief with a go/no-go recommendation. Internal codename: `greenlight-studio`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Clerk (auth), Supabase (database, migrations in `supabase/migrations/`)
- Claude Agent SDK (agent orchestration), Gemini (image generation)
- Tailwind CSS v4 (via PostCSS) + CSS modules
- Vercel (hosting; crons in `vercel.json`), background worker (`src/worker/`, built with tsup)

## Commands

```bash
npm run dev          # Next.js dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest (unit/integration)
npm run test:e2e     # playwright
npm run worker:build # build the background job worker (tsup)
npm run worker:dev   # run worker in watch mode
```

## Project structure

- `src/app/` — App Router pages and API routes. Public marketing pages: `/`, `/about`, `/resources`, `/contact`, `/privacy`, `/terms`. Authenticated app: `/board`, `/dashboard`, `/projects/*`, `/inbox`, `/tasks`, `/chat`, `/settings`, `/onboarding`.
- `src/components/` — Shared React components (landing sections, forms, decision bars).
- `src/lib/` — Core logic: agent orchestration (`agent.ts`), phase pipelines, integrations, scanner.
- `src/worker/` — Background job handlers (night shift cycles, code generation, etc.).
- `src/types/` — Zod schemas and domain types.
- `public/` — Static assets, plus agent-discovery files (`llms.txt`, `agents.md`, `.well-known/`).
- `supabase/migrations/` — Database migrations.
- `tests/` — vitest (unit/integration) and playwright (e2e) suites.
- `content/editorial/` — Editorial content JSON for `/resources`.

## Conventions

- TypeScript strict; run `npm run typecheck` and `npm run lint` before considering work done.
- Do not modify visible above-the-fold landing content (hero, nav, primary CTAs) or any pricing/checkout/signup surface without explicit instruction.
- Destructive actions in the UI (e.g., "Kill Project") are tagged with `data-agent-danger` and `data-agent-confirm`; never trigger them without explicit human confirmation.
- Do not commit, push, or run git mutations unless explicitly asked.
