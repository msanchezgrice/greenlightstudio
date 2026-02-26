# Greenlight Studio

Production Next.js implementation of Greenlight Studio from `spec-v2.3.html` and the attached mockups.

## What is implemented

- Clerk-authenticated multi-tenant app
- Supabase-backed projects, phase packets, approvals, tasks, scan cache, assets, deployments, execution logs, email jobs
- Onboarding wizard: `S0 Import -> S1 Discover -> S1.5 Results/Error -> S2 Clarify -> S3 Confirm -> Launch`
- Inline scanner helper (no scanner MCP)
- Phase packet generation with Anthropic Agent SDK
  - Phase 0: research + CEO packet
  - Phase 1: validate packet
  - Phase 2: distribute packet
  - Phase 3: go-live packet
- Approval inbox with optimistic locking (`version`) and executable action approvals
- Full studio views
  - Board
  - Projects list/detail
  - Phase dashboard (`/projects/[id]/phases`)
  - Phase workspaces (`/projects/[id]/phases/[0-3]`)
  - Phase 0 packet viewer
  - Public packet share route (`/packet/share/[token]`)
  - Tasks/logs
  - Settings
- Landing waitlist submit API (`/api/waitlist`) with persisted signups
- Phase 0 packet actions
  - PDF export (`/api/projects/[id]/packet/export`)
  - Share link generation (`/api/projects/[id]/packet/share`)
- Execution pipeline for approved actions
  - Shared-runtime landing deploy
  - Email queue/send via Resend
  - Meta campaign create (paused)
  - GitHub repository dispatch
  - Vercel deploy hook trigger
- Night Shift route with:
  - due email processing
  - packet-driven nightly action extraction
  - automatic execution-approval queueing
  - while-you-were-away task summaries

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

## Environment variables

Required:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

Required for protected Night Shift:

- `NIGHT_SHIFT_SECRET`
- `CRON_SECRET`

Optional execution integrations:

- `VERCEL_DEPLOY_HOOK_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `GITHUB_TOKEN`

## Deployment

- Vercel project: `greenlight-studio`
- Git integration repo: `https://github.com/msanchezgrice/greenlightstudio`
- Production deploys via push to `main`.

## Product spec assets

- Product spec: `spec-v2.3.html`
- Mockups: `mockups/`
- Reviews: `reviews/`
