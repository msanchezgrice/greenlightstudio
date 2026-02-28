# Greenlight Studio -- Polsia-Style Refactor Spec (Jobs + Workers + Realtime)

**Audience:** Codex (implementation agent)  
**Repo:** `msanchezgrice/greenlightstudio`  
**Goal:** Refactor the current Vercel-only app into a Polsia-like "startup operating system" where multiple agents run in parallel, keep durable memory/state, and stream real activity to the UI -- without Vercel timeouts or Render container instability.

This spec is written to be implemented **end-to-end** as a single refactor, but it is sequenced into safe milestones.

---

## 0) Current implementation (facts from repo)

### Current stack
- Next.js app deployed on Vercel (`vercel.json` runs cron at `/api/nightshift/run`)  
- Supabase Postgres + Storage; Clerk auth; actions: Resend email, Meta campaign, GitHub dispatch, Vercel deploy hook  
- Claude Agent SDK used for Phase packet generation and chat (`@anthropic-ai/claude-agent-sdk` in `package.json`)

### Key current flows (important for refactor)
1) **Phase 0 generation runs inside a Vercel route** with best-effort `after()`:
   - `src/app/api/projects/[projectId]/launch/route.ts` calls `after(() => runPhase0(...))` and sets `maxDuration = 800` seconds.
2) **Approvals can execute actions inline** in the approval decision route:
   - `src/app/api/inbox/[approvalId]/decision/route.ts` calls `executeApprovedAction(...)` during approval. Also has `maxDuration = 800`.
3) **Night shift loops projects inside one request**:
   - `src/app/api/nightshift/run/route.ts` loops up to 50 projects in one execution (`maxDuration = 800`).
   - Also calls `processWeeklyDigests()` and `processNudgeEmails()` from `@/lib/drip-emails` after the project loop.
4) **Chat is synchronous**:
   - `src/app/api/projects/[projectId]/chat/route.ts` inserts user msg, calls `generateProjectChatReply` (Claude Agent SDK), inserts assistant msg, returns. Also `maxDuration = 800`.
5) **"Tasks" table is semi-stateful but unreliable**:
   - `log_task()` (in `src/lib/supabase-mcp.ts`) inserts into both `tasks` and `task_log`. For terminal statuses (`completed`/`failed`), it attempts to update a matching `running` task with the same `(project_id, agent, description)`. However, if the description text differs between start and end (which happens in practice), old `running` rows persist indefinitely.
   - UI currently treats `tasks.status='running'` as active work, which becomes inaccurate over time.
   - 9+ UI components depend on `tasks.status='running'`: tasks page, project detail, phases pages, chat page, batch progress, animated task queue, agent process panel, and the `agents/live` API endpoint. All use `getRunningTasks()` / `getAllRunningTasks()` from `src/lib/studio.ts`.

This refactor fixes these structural issues so you can scale to Polsia-like parallelism safely.

---

## 1) Target architecture (Polsia-aligned)

### Planes
1) **Control plane (Vercel)**  
   - UI + auth + approvals  
   - API routes *enqueue jobs* and return quickly  
   - Streams job events to clients (SSE)  

2) **Execution plane (Workers)**  
   - A Node/TS worker service (Render "Background Worker" recommended)  
   - Claims jobs from DB, runs agent/tool work, logs events, writes artifacts back to Supabase  

3) **Memory & state plane (Supabase Postgres + Storage)**  
   - Durable job state + event log ("alive feed")  
   - Canonical "company brain" docs/facts/chunks (phase D)  

4) **Tool plane (Adapters)**  
   - Resend / GitHub / Meta / Vercel deploy / scanners / future Codex runner  
   - Hard permission ladder & caps

### Key principles
- **No long work in request/response handlers.** Handlers enqueue a job and return.  
- **Idempotent execution.** Every executable action has an idempotency key to prevent duplicate sends/deploys.  
- **Append-only event stream.** UI "alive" feel comes from real job events in DB, streamed to clients.  
- **Parallelism is worker concurrency**, not Vercel concurrency.

---

## 2) Deliverables to implement in this PR

### New capabilities delivered
- Durable job queue: `agent_jobs`
- Durable event stream: `agent_job_events`
- Persistent agent memory store: `agent_memory`
- Sentinel "system" project row for non-project-scoped jobs
- Worker service: claims jobs and executes handlers for:
  - `phase0.generate_packet`
  - `phase.generate_packet` (phase 1/2/3 packet generation)
  - `approval.execute` (deploy/email/ads/github/deploy hook)
  - `email.process_due`
  - `drip.process_digests` (weekly digest emails)
  - `drip.process_nudges` (nudge emails)
  - `nightshift.cycle_project`
  - `chat.reply`
  - `code.generate_mvp` (full website/MVP generation via Claude Agent SDK with code-writing tools, committed to GitHub, deployed via Vercel)
  - `research.generate_report` (web research + PowerPoint/PDF deliverable generation using pptxgenjs/pdf-lib)
  - `browser.check_page` (Playwright headless browser for landing page validation, screenshots, and QA)
- Agent memory system: agents read/write persistent knowledge between runs, building project context over time
- New agent profiles with expanded tool access (code generation, file writing, shell execution)
- SSE stream endpoint: `/api/projects/[projectId]/events`  
- UI updates:
  - Project chat becomes async + streaming (ephemeral deltas via SSE, final message INSERT on completion)
  - Tasks/Board "alive feed" comes from job events (not polling tasks table)

---

## 3) Database migrations (Supabase)

Create **one new migration** plus a small patch migration to add indexes/columns.

### 3.1 Migration: `supabase/migrations/20260227_agent_jobs.sql`

```sql
-- Sentinel "system" project for non-project-scoped jobs (email, drip)
-- Use a well-known UUID so enqueue code can reference it by constant.
insert into public.projects (id, name, owner_clerk_id, phase, runtime_mode)
values ('00000000-0000-0000-0000-000000000000', '__system__', 'system', 0, 'shared')
on conflict (id) do nothing;

-- Agent Jobs + Event Stream
create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  job_type text not null, -- e.g. phase0.generate_packet, approval.execute, chat.reply
  agent_key text not null, -- ceo, research, design, engineering, night_shift, etc.

  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','canceled')),

  priority int not null default 0,
  payload jsonb not null default '{}'::jsonb,

  -- idempotency: prevent duplicates (per logical work item)
  idempotency_key text not null,

  run_after timestamptz not null default now(),

  attempts int not null default 0,
  max_attempts int not null default 3,

  locked_at timestamptz,
  locked_by text,

  last_error text,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists idx_agent_jobs_idempotency
  on public.agent_jobs(project_id, idempotency_key);

create index if not exists idx_agent_jobs_ready
  on public.agent_jobs(status, run_after, priority desc, created_at);

create index if not exists idx_agent_jobs_project
  on public.agent_jobs(project_id, created_at desc);

create table if not exists public.agent_job_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null references public.agent_jobs(id) on delete cascade,

  type text not null, -- status|log|delta|tool_call|tool_result|artifact
  message text,
  data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_agent_job_events_job_created
  on public.agent_job_events(job_id, created_at asc);

create index if not exists idx_agent_job_events_project_created
  on public.agent_job_events(project_id, created_at desc);

create index if not exists idx_agent_job_events_project_cursor
  on public.agent_job_events(project_id, created_at, id);

-- Execution status on approvals to prevent double-run
alter table public.approval_queue
  add column if not exists execution_status text not null default 'idle'
    check (execution_status in ('idle','queued','running','completed','failed'));

alter table public.approval_queue
  add column if not exists execution_job_id uuid references public.agent_jobs(id) on delete set null;

-- Ensure action_executions is idempotent per approval
create unique index if not exists idx_action_executions_unique_approval
  on public.action_executions(approval_id);

-- RPC: claim jobs using SKIP LOCKED (service role / server only)
create or replace function public.claim_agent_jobs(p_worker_id text, p_limit int default 5)
returns setof public.agent_jobs
language plpgsql
as $$
begin
  return query
  with next_jobs as (
    select id
    from public.agent_jobs
    where status = 'queued'
      and run_after <= now()
    order by priority desc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.agent_jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1
  from next_jobs
  where j.id = next_jobs.id
  returning j.*;
end;
$$;

-- RPC: mark job completed/failed (only sets completed_at for terminal success)
create or replace function public.complete_agent_job(p_job_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
as $$
begin
  update public.agent_jobs
  set status = p_status,
      last_error = p_error,
      completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_job_id;
end;
$$;

-- RPC: reclaim stale jobs (worker crashed with jobs in 'running' state)
create or replace function public.reclaim_stale_jobs(p_stale_threshold interval default '10 minutes')
returns int
language plpgsql
as $$
declare
  reclaimed int;
begin
  with stale as (
    select id
    from public.agent_jobs
    where status = 'running'
      and locked_at < now() - p_stale_threshold
      and attempts < max_attempts
    for update skip locked
  )
  update public.agent_jobs j
  set status = 'queued',
      locked_at = null,
      locked_by = null,
      last_error = 'reclaimed: worker presumed dead'
  from stale
  where j.id = stale.id;

  get diagnostics reclaimed = row_count;
  return reclaimed;
end;
$$;

-- Agent memory: persistent knowledge store for cross-run learning
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null, -- 'fact', 'preference', 'decision', 'learning', 'context'
  key text not null,
  value text not null,
  source_job_id uuid references public.agent_jobs(id) on delete set null,
  agent_key text not null,
  confidence float not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_agent_memory_project_key
  on public.agent_memory(project_id, category, key);

create index if not exists idx_agent_memory_project_category
  on public.agent_memory(project_id, category, updated_at desc);

alter table public.agent_memory enable row level security;

drop policy if exists agent_memory_select_own on public.agent_memory;
create policy agent_memory_select_own on public.agent_memory
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

-- RLS: keep current pattern (server uses service key), but protect client reads via project ownership.
alter table public.agent_jobs enable row level security;
alter table public.agent_job_events enable row level security;

drop policy if exists agent_jobs_select_own on public.agent_jobs;
create policy agent_jobs_select_own on public.agent_jobs
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists agent_job_events_select_own on public.agent_job_events;
create policy agent_job_events_select_own on public.agent_job_events
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );
```

> Note: This repo currently uses Clerk and typically queries Supabase via **service role** from server components/routes. Client realtime via Supabase auth is not wired, so this spec provides **SSE** streaming from server instead of direct Supabase Realtime subscriptions. RLS policies above are still useful if you later integrate Clerk JWT with Supabase Auth.

### 3.2 Migration: `supabase/migrations/20260227_project_events.sql` (optional but recommended)
If you want a single "project event feed" across jobs, approvals, etc., add:

```sql
create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null,
  message text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_events_project_created
  on public.project_events(project_id, created_at desc);
```

Not required for MVP because `agent_job_events` already acts as the feed.

---

## 4) Worker service (Render background worker)

### 4.1 New files

Create:

```
src/worker/
  index.ts
  worker-config.ts
  job-handlers/
    index.ts
    phase0-generate.ts
    phase-generate.ts
    approval-execute.ts
    email-process-due.ts
    drip-process-digests.ts
    drip-process-nudges.ts
    nightshift-cycle-project.ts
    chat-reply.ts
    code-generate-mvp.ts
    research-generate-report.ts
    browser-check-page.ts
  job-events.ts
  memory.ts
  supabase-admin.ts
```

### 4.2 NPM scripts (modify `package.json`)
Add:

```json
{
  "scripts": {
    "worker:dev": "tsx src/worker/index.ts",
    "worker:start": "node dist/worker/index.js",
    "worker:build": "tsup src/worker/index.ts --format esm --out-dir dist/worker"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "tsup": "^8.0.0"
  }
}
```

> **Build note:** The worker imports from `@/lib/*` path aliases. Raw `tsc` with `NodeNext` module resolution will not resolve these. `tsup` (esbuild-based) handles aliases natively and produces a single bundled output. Use `tsx` for local dev, `tsup` for production builds.

No separate `tsconfig.worker.json` is needed since `tsup` reads the base `tsconfig.json` and resolves paths automatically.

### 4.3 Worker env vars
In Render worker:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- Integration secrets used by existing code: `RESEND_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `GITHUB_TOKEN`, `VERCEL_DEPLOY_HOOK_URL`
- `APP_BASE_URL` (e.g. `https://your-vercel-domain.vercel.app`) -- needed by approval-execute handler for live URL generation
- `WORKER_ID` (e.g. `worker-1`)
- `WORKER_CONCURRENCY` (e.g. `3`)
- `WORKER_POLL_MS` (e.g. `1000`)

### 4.4 Worker algorithm (must implement)
- Poll loop:
  - call `rpc('claim_agent_jobs', { p_worker_id, p_limit })`
  - process claimed jobs concurrently up to `WORKER_CONCURRENCY`
  - on completion call `rpc('complete_agent_job', { p_job_id, p_status, p_error })`
- Each handler:
  - writes `agent_job_events` as it progresses
  - must be idempotent using job.idempotency_key and unique constraints
- Stale lock recovery:
  - On each poll cycle (or every N cycles), call `rpc('reclaim_stale_jobs')` to reclaim jobs from crashed workers
- Graceful shutdown:
  - Listen for `SIGTERM`/`SIGINT`
  - Stop claiming new jobs
  - Wait for in-flight jobs to complete (with a timeout)
  - Mark any still-running jobs as `queued` for re-claim

### 4.5 Worker code skeleton (high-level)

`src/worker/index.ts`:
- create admin supabase client
- load config
- register SIGTERM handler
- infinite loop:
  - optionally call `reclaim_stale_jobs`
  - claim jobs
  - dispatch to handler map
  - await all with concurrency
  - sleep poll ms

---

## 5) Job types and handlers (exact behavior)

### 5.1 `phase0.generate_packet`
**Payload:**
```json
{
  "projectId": "...",
  "ownerClerkId": "...",
  "revisionGuidance": null,
  "forceNewApproval": false
}
```

**Handler:**
- Emit events: `status: started`, `log: init`, `log: research`, `log: synthesis`
- Call existing `runPhase0({ projectId, userId: ownerClerkId, revisionGuidance, forceNewApproval })`
- On success emit `status: completed`
- On failure emit `status: failed` and call existing `logPhase0Failure(projectId, error)`.

**Important change required:** `runPhase0()` currently logs to `tasks` via `log_task`. Keep that for now, but primary feed should be job events.

### 5.2 `phase.generate_packet`
Generate Phase 1/2/3 packets + queue approvals.

**Payload:**
```json
{
  "projectId": "...",
  "phase": 1,
  "forceRegenerate": false,
  "revisionGuidance": null
}
```

**Handler:**
- Calls `enqueueNextPhaseArtifacts(projectId, phase, { forceRegenerate, revisionGuidance })`
- Emits events as above.

### 5.3 `approval.execute`
Executes an approved action (deploy/email/ads/github/deploy hook).

**Payload:**
```json
{
  "approvalId": "...",
  "projectId": "...",
  "actionType": "deploy_landing_page"
}
```

**Handler steps:**
1) Update `approval_queue.execution_status = 'running'` (idempotently)
2) Load approval row + project row + owner email
3) Call existing `executeApprovedAction(...)`
4) On success:
   - set `approval_queue.execution_status='completed'`
   - emit event `artifact` with live url / message id / campaign id
5) On failure:
   - set `approval_queue.execution_status='failed'`
   - emit `failed` event with error

**Idempotency:**
- Unique index `action_executions(approval_id)` prevents double execution. If an execution row already exists with `completed`, handler should skip.

### 5.4 `email.process_due`
Processes queued emails due in `email_jobs`.

**Payload:**
```json
{ "limit": 100 }
```

**Handler:**
- Calls existing `processDueEmailJobs(limit)` (default limit in the function is 50; the nightshift route currently calls with 100)
- Emits summary event including `queued/sent/failed`

> **Note:** This is a system-wide job not tied to a specific project. Use the sentinel system project UUID (`00000000-0000-0000-0000-000000000000`) as `project_id`.

### 5.5 `drip.process_digests`
Processes weekly digest emails. Currently called inline in nightshift route via `processWeeklyDigests()` from `@/lib/drip-emails`.

**Payload:**
```json
{}
```

**Handler:**
- Calls existing `processWeeklyDigests()`
- Emits summary event

> Uses sentinel system project UUID as `project_id`.

### 5.6 `drip.process_nudges`
Processes nudge emails. Currently called inline in nightshift route via `processNudgeEmails()` from `@/lib/drip-emails`.

**Payload:**
```json
{}
```

**Handler:**
- Calls existing `processNudgeEmails()`
- Emits summary event

> Uses sentinel system project UUID as `project_id`.

### 5.7 `nightshift.cycle_project`
Runs night shift for one project (instead of looping many projects in one Vercel request).

**Payload:**
```json
{ "projectId": "..." }
```

**Handler:**
Port logic from `src/app/api/nightshift/run/route.ts` but scoped to one project:
- if pending approvals > 0 -> log skip
- load latest packet -> derive actions via `deriveNightShiftActions()` from `@/lib/nightshift` -> enqueue approvals
- write summary task/event
- if failures -> queue a failure review approval

### 5.8 `chat.reply`
Generates an assistant message in project chat.

**Payload:**
```json
{
  "projectId": "...",
  "ownerClerkId": "...",
  "userMessageId": "...",
  "message": "..."
}
```

**Handler (ephemeral streaming -- no placeholder row):**
- Call `generateProjectChatReply(...)` with a new streaming callback (see Section 7).
- As deltas arrive, emit `delta` job events (throttled). The UI renders these ephemerally in client state.
- On completion: INSERT the final assistant message into `project_chat_messages` (same as current behavior).
- The database only stores the final result; no placeholder rows, no progressive UPDATE.

### 5.9 `code.generate_mvp`
Generates a full website or MVP using Claude Agent SDK with code-writing tools enabled, commits to GitHub, and triggers deployment.

**Payload:**
```json
{
  "projectId": "...",
  "ownerClerkId": "...",
  "description": "Build a landing page with waitlist form and Stripe checkout",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "greenlight/mvp-v1"
}
```

**Handler:**
- Load project context: phase packet, brand kit, existing agent memory
- Create a temp workspace directory for the agent
- Run Claude Agent SDK with the `code_generator` profile (tools: `Read`, `Write`, `Edit`, `Shell`, `WebSearch`)
  - Agent generates files in the workspace
  - Emit `log` and `delta` events as work progresses
- On completion:
  - Commit files to GitHub using existing `GITHUB_TOKEN` (create branch, push via GitHub API)
  - Trigger Vercel deploy hook if `permissions.deploy === true`
  - Store generated file manifest as job event artifact
  - Write learnings to `agent_memory` (e.g., tech stack chosen, design decisions)
- Emit `artifact` event with commit URL and deploy URL

**New agent profile required:**
```ts
code_generator: {
  name: 'code_generator',
  tools: ['Read', 'Write', 'Edit', 'Bash', 'WebSearch'],
  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'WebSearch'],
  maxTurns: 30,
  timeoutMs: 1_800_000, // 30 minutes
  permissionMode: 'dontAsk',
}
```

### 5.10 `research.generate_report`
Conducts web research and produces a PowerPoint or PDF deliverable.

**Payload:**
```json
{
  "projectId": "...",
  "ownerClerkId": "...",
  "topic": "Competitive analysis for AI-powered CRM tools",
  "format": "pptx",
  "maxSlides": 15
}
```

**Handler:**
- Load project context and agent memory for the project
- Run Claude Agent SDK with the `researcher_report` profile (tools: `WebSearch`, `WebFetch`)
  - Agent researches the topic and produces structured JSON: `{ title, slides: [{ title, bullets, notes, data? }] }`
  - Emit `log` events as research progresses
- Convert structured output to PowerPoint (using `pptxgenjs`, already installed) or PDF (using `pdf-lib`, already installed)
- Upload file to Supabase Storage under `project-assets/{projectId}/reports/`
- Store key findings in `agent_memory` for future reference
- Emit `artifact` event with download URL

**New agent profile required:**
```ts
researcher_report: {
  name: 'researcher_report',
  tools: ['WebSearch', 'WebFetch'],
  allowedTools: ['WebSearch', 'WebFetch'],
  maxTurns: 15,
  timeoutMs: 900_000, // 15 minutes
  permissionMode: 'dontAsk',
}
```

### 5.11 `browser.check_page`
Uses Playwright to validate a deployed landing page -- screenshots, checks for broken elements, validates structure.

**Payload:**
```json
{
  "projectId": "...",
  "url": "https://example.vercel.app",
  "checks": ["screenshot", "mobile_responsive", "waitlist_form", "meta_tags"]
}
```

**Handler:**
- Launch Playwright headless Chromium (must be installed in worker environment)
- Navigate to URL
- Perform checks:
  - **screenshot**: Full-page screenshot, upload to Supabase Storage, emit artifact with URL
  - **mobile_responsive**: Resize to mobile viewport, screenshot, compare
  - **waitlist_form**: Check for form element presence, verify POST endpoint
  - **meta_tags**: Check Open Graph tags, title, description
- Emit `log` events per check, `artifact` event with screenshot URLs
- Store QA results in `agent_memory` (e.g., "landing page passes all checks" or "missing OG image")

**No agent profile needed** -- this handler uses Playwright programmatically, not the Claude Agent SDK.

**Dependency:** Move `@playwright/test` from devDependencies to dependencies. Add Playwright browser install to worker build/start script.

---

## 5.12 Agent memory system

The memory system enables agents to learn and build context across runs.

### Memory helpers (`src/worker/memory.ts`)
- `loadMemory(db, projectId, categories?)` -- returns relevant memories for a project, optionally filtered by category
- `writeMemory(db, projectId, entries)` -- upserts memory entries (keyed by project_id + category + key)
- `formatMemoryForPrompt(memories)` -- formats memories as a string block to inject into agent prompts

### Integration with handlers
Every agent-based handler (phase0, phase-gen, chat, code-gen, research) should:
1. Before the agent call: load relevant memories and inject them into the prompt context
2. After the agent call: extract key facts/decisions/learnings and write them to memory

### Memory categories
- `fact`: Objective facts about the project (industry, target audience, competitors)
- `preference`: User preferences (design style, tech stack, tone)
- `decision`: Decisions made during agent runs (chose React, targeted B2B, etc.)
- `learning`: Lessons from past runs (what worked, what failed)
- `context`: Accumulated context (meeting notes, feedback, research findings)

---

## 6) Vercel API route refactor (enqueue-only)

### 6.1 Add a shared enqueue helper
Create `src/lib/jobs/enqueue.ts`:

- `enqueueJob({ projectId, jobType, agentKey, payload, idempotencyKey, priority, runAfter })`
- Uses Supabase service role and inserts into `agent_jobs`.
- On conflict (unique violation on `project_id + idempotency_key`), fetch and return the existing job id.
- **Important:** Check `error.code === '23505'` (Postgres unique violation) before assuming conflict. Other insert errors (network, FK violation) should propagate as real errors.

### 6.2 Change `/api/projects/[projectId]/launch`
File: `src/app/api/projects/[projectId]/launch/route.ts`

Replace `after(runPhase0...)` with:
- Validate ownership as now
- If packet already exists and no force/guidance, return alreadyCompleted
- Enqueue job:
  - `job_type=phase0.generate_packet`
  - `agent_key=ceo`
  - `idempotency_key = "phase0:{projectId}:{guidanceHash}:{forceNewApproval}"`
- Return `{ ok: true, jobId, started: true }`

### 6.3 Change `/api/inbox/[approvalId]/decision`
File: `src/app/api/inbox/[approvalId]/decision/route.ts`

Today it executes inline. New behavior:
- Update approval status/version exactly as now
- If `decision === approved` and `action_type` is executable:
  - update `approval_queue.execution_status='queued'`
  - enqueue job `approval.execute` with idempotency key `approval:{approvalId}`
  - set `approval_queue.execution_job_id` to that job id
- If phase advance approval:
  - enqueue job `phase.generate_packet` for next phase (instead of calling `enqueueNextPhaseArtifacts` inline)
  - Use **stable** idempotency key: `phasegen:{projectId}:{nextPhase}` (do NOT include `Date.now()` -- it defeats idempotency)

### 6.4 Change `/api/nightshift/run`
File: `src/app/api/nightshift/run/route.ts`

New behavior:
- Authenticate via CRON secret as now
- Enqueue `email.process_due` once (idempotency key includes date/hour, uses sentinel system project)
- Enqueue `drip.process_digests` once (idempotency key includes date, uses sentinel system project)
- Enqueue `drip.process_nudges` once (idempotency key includes date, uses sentinel system project)
- For each `projects.night_shift=true`:
  - enqueue `nightshift.cycle_project` with idempotency key `nightshift:{projectId}:{YYYY-MM-DD}`
- Return summary of how many jobs queued.

### 6.5 Change `/api/projects/[projectId]/chat`
File: `src/app/api/projects/[projectId]/chat/route.ts`

- POST:
  - Insert user message (keep)
  - Enqueue `chat.reply` job
  - Return `{ ok: true, jobId }` (do NOT wait for assistant)
- GET: return chat history as now
- Add a new GET endpoint `/api/projects/[projectId]/chat/status` (optional) that returns latest running chat job.

### 6.6 Add `/api/projects/[projectId]/events` (SSE)
New file: `src/app/api/projects/[projectId]/events/route.ts`

Behavior:
- Clerk auth required
- Verify project belongs to user
- Accept query params:
  - `cursor` (optional) = last seen event timestamp + id, or just ISO timestamp
- On connect:
  - query last N events from `agent_job_events` for project, newer than cursor
  - stream them via SSE
- Then long-poll in a loop (e.g. 25 seconds total):
  - every 1s query for new events
  - send keep-alive `event: ping`
- Return closes; client auto-reconnects with last cursor.

> This avoids needing Supabase Realtime client auth integration with Clerk. For the expected user count this is fine; if concurrent viewers become a concern, integrate Clerk JWT with Supabase Auth and switch to Supabase Realtime subscriptions.

---

## 7) Streaming deltas from Claude Agent SDK (required for "alive" feel)

### 7.1 Modify `src/lib/agent.ts` to support delta callbacks
Currently `executeQueryAttempt` builds `streamedRaw` from `stream_event` messages (it already extracts delta text via `extractDeltaText`).

**Signature note:** `executeQueryAttempt` currently has 5 parameters: `(prompt, options, profile, agentProfile, traceTarget?)`. Add a 6th `hooks` parameter (or fold into `options`):

- `hooks?: { onTextDelta?: (delta: string) => void }`

When `message.type === "stream_event"`:
- call `hooks.onTextDelta(extractDeltaText(...))` if present and delta non-empty

Then:
- For `generateProjectChatReply`, pass `onTextDelta` from the chat job handler.
- Persist deltas to `agent_job_events` only (no DB row updates during streaming -- ephemeral approach).
- Only use hooks for the chat path, not for packet JSON generation paths (those stay strict JSON).

### 7.2 Ensure throttle
To avoid spamming DB with job events:
- Buffer deltas and flush every ~250ms OR every ~500 chars.

---

## 8) UI refactor (realtime without polling)

### 8.1 Chat UI (`src/components/project-chat-pane.tsx`)
Change flow:
- On submit:
  - POST message -> receives `{ jobId }`
  - Open SSE stream for `/api/projects/${projectId}/events`
  - While job running, render streamed deltas as ephemeral assistant bubble content (client state only)
- On job completion: call `reloadMessages()` to fetch the final persisted assistant message.

### 8.2 Tasks page / Board
- Replace reliance on `tasks` table for "alive" updates.
- Add a client component that subscribes to SSE and updates the "Recent Activity" / "Running agents" UI.

Minimal approach:
- Keep server-rendered initial state (existing queries)
- Add client component that:
  - listens to SSE
  - when it receives events, calls `router.refresh()` *only when needed* (e.g. status completed/failed)
  - renders a small "Live activity" ticker from events immediately

Better approach (recommended):
- Store live state in client store (zustand) and patch UI directly without refresh.

### 8.3 Backward compatibility (tasks table migration)
Keep writing `log_task` for backward compatibility so all existing UI components continue working:
- `src/app/tasks/page.tsx`
- `src/components/animated-task-queue.tsx`
- `src/components/agent-process-panel.tsx` (polls `/api/projects/[projectId]/agents/live`)
- `src/components/batch-progress.tsx`
- `src/components/chat-page.tsx`
- `src/app/projects/[projectId]/page.tsx`
- `src/app/projects/[projectId]/phases/page.tsx`
- `src/lib/studio.ts` -- `getRunningTasks()` and `getAllRunningTasks()`

Over time, migrate these components to read from `agent_job_events` and retire the `tasks` table dependency. The `agents/live` endpoint should eventually query `agent_jobs` instead of `tasks`.

Keep the `LiveRefresh` component (`src/components/live-refresh.tsx`) active for non-SSE pages.

---

## 9) Worker + Render deployment (recommended)

### 9.1 Add `render.yaml` (optional)
Define:
- `services`:
  - `greenlight-worker` (type=worker, build command: `npm run worker:build`, start command: `node dist/worker/index.js`)
- configure env vars

### 9.2 Concurrency & safety
- Start with `WORKER_CONCURRENCY=3`
- Enforce per-job timeouts in handler (e.g. 10 minutes for phase0)
- On timeout: mark job failed with retriable error and respect `max_attempts`

### 9.3 Graceful shutdown
- On `SIGTERM`: stop claiming new jobs, wait for in-flight jobs (up to 30s), then mark any remaining as `queued` for re-claim.

### 9.4 Stale lock recovery
- Call `reclaim_stale_jobs()` on every Nth poll cycle (e.g. every 60 seconds).
- Default threshold: 10 minutes. Jobs locked longer than this with `status='running'` are presumed orphaned and reset to `queued`.

---

## 10) Refactor PR checklist (Codex must follow)

### A) DB
- [ ] Add migrations for `agent_jobs`, `agent_job_events`, `agent_memory`, sentinel system project, approval execution columns, unique index on `action_executions.approval_id`, `reclaim_stale_jobs` RPC
- [ ] Apply migrations locally (`supabase db push`)
- [ ] Run `supabase gen types typescript` to update TypeScript types for new tables

### B) Enqueue primitives
- [ ] Implement `src/lib/jobs/enqueue.ts` (with `error.code === '23505'` check for conflict detection)
- [ ] Implement `src/lib/jobs/constants.ts` (job type strings including drip types, priorities, agent keys, sentinel system project UUID)

### C) Worker runtime
- [ ] Add `src/worker/*` files
- [ ] Implement claim loop via `rpc('claim_agent_jobs', ...)`
- [ ] Implement core job handlers (phase0, phase1-3, approval.execute, email.process_due, drip.process_digests, drip.process_nudges, nightshift.cycle_project, chat.reply)
- [ ] Implement new capability handlers: `code.generate_mvp`, `research.generate_report`, `browser.check_page`
- [ ] Implement `emitJobEvent(jobId, projectId, type, message, data)` helper
- [ ] Implement `src/worker/memory.ts` (loadMemory, writeMemory, formatMemoryForPrompt)
- [ ] Implement graceful shutdown (SIGTERM handler)
- [ ] Implement stale lock recovery (periodic `reclaim_stale_jobs` calls)
- [ ] Add new agent profiles to `src/lib/agent.ts`: `code_generator`, `researcher_report`
- [ ] Move `@playwright/test` to dependencies; add browser install to worker setup

### D) API routes (enqueue only)
- [ ] Update launch route to enqueue phase0 job
- [ ] Update inbox decision route to enqueue execute job + next-phase generation job (stable idempotency keys)
- [ ] Update nightshift route to enqueue per-project nightshift jobs + email + drip digest + drip nudge jobs
- [ ] Update chat route to enqueue chat.reply job
- [ ] Add SSE events endpoint

### E) Streaming support
- [ ] Modify `src/lib/agent.ts` to support delta callbacks (6th parameter or folded into options)
- [ ] Implement chat.reply ephemeral streaming to job events (no placeholder DB rows)

### F) UI updates
- [ ] Update ProjectChatPane to use async + SSE streaming (ephemeral client-side deltas)
- [ ] Add minimal live activity ticker to Tasks page using SSE (optional but recommended)
- [ ] Keep existing tables/pages working (continue writing `log_task` for backward compat)

### G) Tests / verification
- [ ] Add integration test for enqueue idempotency (same idempotency key -> single job)
- [ ] Add test for approval.execute idempotency (unique index prevents duplicates)
- [ ] Smoke test: create project -> launch -> see job events -> packet appears -> approval appears -> approve -> execution enqueued -> deployment artifact created

---

## 11) Acceptance criteria

1) **No route performs long-running agent work**  
   - Phase0 generation is a job; chat reply is a job; approvals execution is a job.

2) **Parallelism works**  
   - Multiple jobs for different projects run concurrently in worker.

3) **Alive feed works**  
   - `/api/projects/[id]/events` streams events while work runs.

4) **Idempotency**  
   - Approving an action twice or retrying a job does not send emails twice or deploy twice.

5) **Night shift scales**  
   - Cron enqueues project cycles; each project runs independently.

6) **Worker resilience**
   - Crashed workers' jobs are reclaimed within 10 minutes.
   - Graceful shutdown completes in-flight work.

---

## 12) Notes for future (Phase D+)

Once this refactor is done, you can cleanly add:
- Social read/post tools with caps and approvals
- Multi-agent collaboration chains (one job enqueues others)
- `agents/live` endpoint migration from `tasks` table to `agent_jobs`
- Vector embeddings for agent memory (semantic retrieval)
- Custom MCP tool integrations per project

---

## Appendix: Job type naming conventions

Use `domain.action` style:
- `phase0.generate_packet`
- `phase.generate_packet`
- `approval.execute`
- `nightshift.cycle_project`
- `email.process_due`
- `drip.process_digests`
- `drip.process_nudges`
- `chat.reply`
- `code.generate_mvp`
- `research.generate_report`
- `browser.check_page`

Idempotency keys (must be **stable** -- never include `Date.now()`):
- `phase0:{projectId}:{guidanceHash}:{force}`
- `phasegen:{projectId}:{phase}`
- `approval:{approvalId}`
- `nightshift:{projectId}:{YYYY-MM-DD}`
- `email_due:{YYYYMMDDHH}`
- `drip_digests:{YYYY-MM-DD}`
- `drip_nudges:{YYYY-MM-DD}`
- `chat:{projectId}:{userMessageId}`
- `codegen:{projectId}:{descriptionHash}`
- `research:{projectId}:{topicHash}`
- `browser:{projectId}:{urlHash}:{checksHash}`

Sentinel system project UUID: `00000000-0000-0000-0000-000000000000`
