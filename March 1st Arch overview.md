# March 1st Arch overview

Date: 2026-03-01  
Scope: Greenlight Studio production architecture snapshot, with Phase 2 post-payment provisioning status and remaining work.

## 1) Executive summary

Greenlight Studio now has a working Company Brain foundation (mission + memory), a canonical project event ledger, cross-channel context assembly for chat/nightshift/phase generation, inbound email ingestion, recurring automation, KPI ingestion, per-project integration overrides, and a Phase 2 provisioning trigger path from payment activation events.

What is still missing is true dedicated runtime execution after provisioning (actual isolated compute/database/network runtime handoff). Current Phase 2 is a control-plane/state-machine scaffold with eventing and fallback semantics, not a fully isolated runtime plane.

## 2) Current architecture (today)

### 2.1 Planes

- Control plane (Next.js on Vercel)
  - UI, auth, project APIs, enqueue-only behavior for long work.
  - Cron endpoints:
    - `/api/scheduler/run` every minute (from `vercel.json`)
    - `/api/nightshift/run` daily at 06:00 UTC
- Execution plane (Render worker)
  - Claims `agent_jobs` and runs handlers (`chat.reply`, `nightshift.cycle_project`, `phase*.generate_packet`, `approval.execute`, `brain.refresh`, `scheduler.run_recurring`, `runtime.provision_project`, etc.).
- State plane (Supabase)
  - Canonical operational state: projects, packets, tasks, approvals, executions, assets, emails, event ledger, brain docs, recurring tasks, KPI events, runtime provisioning tables.
  - Storage bucket for artifacts including optional brain snapshot `memory.md`.

### 2.2 Company Brain (mission + memory)

Canonical table: `project_brain_documents`
- `mission_markdown` (strategic/stable)
- `memory_markdown` (operational/rolling)
- `memory_version`, `last_event_id`, timestamps

Refresh tracking table: `project_brain_updates`
- queued/running/completed/failed audit rows with reason + trigger event.

Refresh behavior:
- Every `recordProjectEvent` write enqueues debounced `brain.refresh` (10s idempotency bucket).
- Hard refresh backstop via recurring task every 5 minutes (`brain_hard_refresh_5m`).
- `brain.refresh` writes DB brain + emits `brain.refreshed` event + writes `project-assets/{projectId}/brain/memory-latest.md` for observability.

Mission updates:
- API `PUT /api/projects/[projectId]/brain` updates mission only.
- Manual mission update emits `brain.mission_updated` event and triggers manual brain refresh.

### 2.3 Canonical event ledger

Table: `project_events` (append-only by design).

All major surfaces now fan into `recordProjectEvent()`:
- Chat user and assistant messages.
- Inbound/outbound email events.
- Task status updates (via `log_task` path).
- Approval decisions and execution started/completed/failed.
- Phase packet generation.
- Asset upload lifecycle routes.
- Analytics/payments ingestion.
- Nightshift cycle + recommendation generation.
- Brain refresh lifecycle.
- Runtime provisioning requested/started/completed/failed.

Immediate memory fanout:
- Each event writes compact facts into `agent_memory` (`last_event` keys + category mapping).
- Then enqueues debounced brain refresh.

### 2.4 Unified context assembler

Core function: `assembleCompanyContext(projectId)`

Used by:
- `chat.reply`
- `nightshift.cycle_project`
- `phase0.generate_packet`
- `phase.generate_packet`
- brain refresh builder

Context includes:
- mission + memory markdown
- delta events since `last_event_id` (up to 50)
- latest packet summary/confidence
- approvals/tasks/executions/assets
- inbound + outbound email summaries
- KPI snapshot (7d/30d analytics + payments)
- long-term `agent_memory` rows

Prompt shape:
- Mission
- Memory
- Recent delta events
- Operational snapshot

### 2.5 Channels and event ingestion

#### Chat
- `POST /api/projects/[projectId]/chat` stores user message, records `chat.user_message`, enqueues `chat.reply`.
- Worker `chat.reply` assembles company context + memory, generates reply, stores assistant message, records `chat.assistant_reply`.
- Chat intent automation can auto-queue execution approvals when user asks for execution-capable changes.

#### Inbound email
- `POST /api/email/inbound` (secret-protected via `INBOUND_EMAIL_SECRET` header/bearer).
- Resolves project by `project_email_identities.reply_address`.
- Inserts `inbound_email_messages`, optional mirror to project chat as system message, records `email.inbound.received`.

#### Outbound email
- Sends through Resend adapter with project-scoped integration override when present.
- Uses project reply-to identity when available.
- Updates `email_jobs` status and records `email.outbound.sent` / `email.outbound.failed`.

### 2.6 Per-company integrations

Table: `project_integrations` (`provider`, `enabled`, encrypted config, masked preview).

Resolver behavior:
- `resolveIntegration(projectId, provider)` checks project config first.
- Falls back to global environment credentials if missing/disabled/decrypt fails.

Encryption:
- AES-256-GCM using `PROJECT_INTEGRATION_ENCRYPTION_KEY`.

Current providers wired:
- `resend`, `meta`, `github`, `vercel` (runtime consumers implemented)
- `analytics`, `payments` enum exists but no external adapter execution path yet.

### 2.7 Recurring automation

Table: `project_recurring_tasks`.

Worker job: `scheduler.run_recurring`
- Picks due rows, enqueues mapped jobs with minute-bucket idempotency.
- Advances `next_run_at` and writes project events.
- Triggers scheduled brain refresh enqueue.

Seeded defaults on project create:
- `brain_hard_refresh_5m` (every 5 min)
- `nightly_context_prioritization` (`nightshift.cycle_project`)

### 2.8 Nightly recommendations

Nightshift job:
- Skips if pending approvals exist.
- Assembles full company context including KPIs.
- Derives actions and queues approvals when needed.
- Persists `nightshift_summary` task detail.
- Emits `nightshift.recommendations_generated` with prioritized list.

UI exposure:
- Project page has "Company Brain" and "Nightly Recommendations" sections.

### 2.9 KPI ingestion

Routes:
- `POST /api/projects/[projectId]/analytics/events`
- `POST /api/projects/[projectId]/payments/events`

Tables:
- `project_analytics_events`
- `project_payment_events`

Current KPI summary model (used by chat/nightshift/context):
- traffic, leads, conversion proxy, succeeded payments, revenue (7d/30d).

### 2.10 Security hardening already shipped

Asset preview route now enforces:
- authenticated user
- project ownership
- asset belongs to project and is uploaded

Route:
- `GET /api/projects/[projectId]/assets/[assetId]/preview`

### 2.11 Runtime reliability/observability

Worker hardening:
- Job timeouts no longer crash worker process by default.
- `WORKER_MAX_JOBS_PER_PROCESS` default now non-recycling (`0`) to avoid false crash alarms.

Worker heartbeat system:
- Table: `worker_heartbeats`
- Route: `GET /api/worker/health` (secret-protected)
- Reports stale/healthy worker state + recent failed/timeout diagnostics.

## 3) How post-purchase provisioning works today (Phase 2 current state)

### 3.1 Trigger

Payment ingestion route checks activation-like events:
- `subscription_active`
- `subscription.activated`
- `subscription_updated` + `status=active`

When matched:
- enqueues `runtime.provision_project`
- records `runtime.provisioning_requested`

### 3.2 Provisioning job behavior (implemented scaffold)

Job handler `runtime.provision_project` currently:
1. Ensures/creates `project_runtime_instances` row.
2. Creates `project_provisioning_jobs` audit row.
3. Marks runtime instance `provisioning`.
4. Emits step logs/events (`provision_runtime`, `provision_database`, `configure_secrets`).
5. On success, marks runtime `dedicated` with placeholder endpoint/repo/db refs.
6. Emits `runtime.provisioning_completed`.
7. On failure, sets runtime back to shared mode with failure status/error and emits `runtime.provisioning_failed`.

This gives deterministic state transitions and event visibility, but not true isolated execution yet.

## 4) Gaps and areas to improve

### 4.1 Company Brain quality and freshness

- No semantic dedupe/compression layer in memory summary yet; repeated phrasing can still occur when source events are repetitive.
- `companyContextToMarkdown` embeds mission/memory verbatim; if mission text itself contains nested headers or duplicated sections, prompt verbosity increases.
- Brain refresh is event-driven + 5-min backstop, but no SLA monitoring/alerting is enforced yet (only best-effort behavior).

### 4.2 Recurring scheduler correctness

- `computeNextRunAt` currently supports a limited cron subset and does not truly apply timezone semantics (UTC-centric behavior).
- No UI/API yet for users to manage recurring tasks beyond seeded defaults.

### 4.3 Integrations maturity

- Fallback to global env is convenient but means many projects still effectively share provider accounts.
- Analytics/payments provider entries exist in config model, but adapter usage is not fully implemented.
- No integration health-check dashboard or token expiry alerting yet.

### 4.4 Email channel robustness

- Inbound endpoint uses shared secret auth; provider-native signature verification per vendor is not yet implemented.
- No thread model/conversation linkage beyond raw message storage + optional chat mirroring.

### 4.5 Context completeness

- Most key paths write project events, but coverage should be continuously audited to avoid silent gaps in new features.
- Event taxonomy exists by convention; no strict registry/linter yet.

### 4.6 Runtime mode model mismatch

- Much of app logic still types `runtime_mode` as `"shared" | "attached"` in project schemas/prompt contracts.
- Dedicated provisioning state currently lives in `project_runtime_instances`, not fully reflected in all project/runtime decision paths.

### 4.7 Operational observability

- Worker health endpoint exists, but no automated alert fanout or SLO dashboards are wired.
- No per-project cost attribution reporting yet for dedicated mode economics.

## 5) Remaining Phase 2 work (post-purchase dedicated company provisioning)

### 5.1 Provisioning orchestration: move from scaffold to real infra

Implement real provider-backed steps:
1. Create dedicated runtime service/container per paid project.
2. Create dedicated Neon database and run migrations.
3. Provision per-project secret namespace + bind to runtime.
4. Provision per-project deploy target/domain wiring.
5. Persist real provider identifiers into `project_runtime_instances` / `project_runtime_secrets`.

### 5.2 Routing cutover after dedicated activation

- Execution-capable actions must route through dedicated runtime config once `mode=dedicated`.
- Add runtime resolver abstraction used by:
  - deploy actions
  - code generation/execution actions
  - scheduled job dispatch paths
- Keep shared fallback path for resilience.

### 5.3 Isolation guarantees

- Enforce company-level isolation for:
  - runtime compute namespace
  - database
  - recurring execution scope
  - integration credentials
  - artifact/deploy metadata boundaries

### 5.4 Runtime mode unification

- Unify app-level `projects.runtime_mode` model with `project_runtime_instances.mode/status`.
- Expand type contracts and prompts to include dedicated/provisioning modes where relevant.
- Surface provisioning status clearly in UI (banner + timeline + retries).

### 5.5 Provisioning failure handling and retries

- Implement step-level retries with exponential backoff and terminal classification.
- Add compensating cleanup steps for partially created resources.
- Emit user-facing remediation guidance in failures.

### 5.6 Verification and acceptance gates before broad rollout

Required before enabling for all paid companies:
- End-to-end paid activation -> dedicated runtime with real provider resources.
- Action execution works in dedicated mode (`deploy_landing_page`, email send, at least one recurring task).
- Rollback/fallback to shared mode validated under forced failures.
- Load test for concurrent provisioning jobs.
- Per-project event audit confirms full observability.

## 6) Recommended near-term implementation order

1. Runtime resolver + mode unification in app/domain types.
2. Real Neon provisioning + migration runner in `runtime.provision_project`.
3. Real runtime service creation + secrets binding.
4. Dedicated action routing cutover.
5. Provisioning status UX + retry controls.
6. Integration hardening (provider signature validation, health checks).
7. Scheduler timezone correctness + full cron parser support.
8. Brain quality pass (dedupe/compression + mission sanitization guardrails).

## 7) Practical current-state conclusion

Phase 1 is materially in place and functioning as a Polsia-style shared control plane with cross-channel memory and context continuity.  
Phase 2 currently has trigger + state machine + fallback semantics implemented, but not yet full dedicated runtime execution isolation.  
The next push is infrastructure realization and execution routing cutover so "post-purchase provisioning" becomes operationally real rather than metadata-complete.
