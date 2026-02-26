# Greenlight Studio

Production Next.js implementation of the Greenlight Studio MVG from `spec-v2.3.html`.

## What is implemented

- Clerk-authenticated multi-tenant app
- Supabase-backed projects, phase packets, approvals, tasks, scan cache
- Onboarding wizard: `S0 Import -> S1 Discover -> S1.5 Results/Error -> S2 Clarify -> S3 Confirm -> Launch`
- Inline scanner helper (no scanner MCP)
- Phase 0 packet generation using Anthropic Agent SDK (Research + CEO synthesis)
- Approval inbox with optimistic locking (`version`)
- Packet viewer with structured sections
- Night Shift API run route + Vercel cron wiring

## Local development

1. Copy env vars into `.env.local` (see `.env.example`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run app:
   ```bash
   npm run dev -- --port 4173
   ```
4. Open:
   - App: `http://127.0.0.1:4173`
   - Onboarding: `http://127.0.0.1:4173/onboarding`
   - Inbox: `http://127.0.0.1:4173/inbox`

## QA commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Database

- Migrations are in `supabase/migrations`.
- Apply to linked project:
  ```bash
  supabase db push
  ```

## Deployment

- Vercel project: `greenlight-studio`
- Git integration repo: `https://github.com/msanchezgrice/greenlightstudio`
- Production deploys via push to `main`.

## Product spec assets

- Product spec: `spec-v2.3.html`
- Mockups: `mockups/`
- Reviews: `reviews/`
