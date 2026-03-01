# Greenlight Studio - Polsia Alignment Execution Spec

Status: Draft for approval before implementation
Owner: Codex + Miguel
Date: 2026-03-01

## 1) Goal
Replicate Polsia's strongest product properties while keeping our current control-plane architecture stable:

- Unified company memory/context across channels (chat, project edits/artifacts, approvals, jobs, inbound/outbound email).
- Strict per-company siloing of operational surface area (website/runtime, scripts/jobs, analytics, payments, integrations).
- Phase 1 delivers this on a shared execution plane.
- Phase 2 upgrades paid companies to dedicated provisioned runtime bundles post-payment.

## 2) Non-goals
- Replacing existing onboarding or phase packet UX in this pass.
- Requiring immediate migration away from current global provider credentials before per-project configs exist.
- Instant full sub-account provisioning for every external provider (Meta/Resend/GitHub all have different constraints).

## 3) Phase 1 - Unified Context + Company Silo Foundation

### 3.1 Deliverables (must ship)
1. Canonical per-company event ledger: `project_events`.
2. Single company context assembler used by chat + nightshift + phase generation jobs.
3. Nightly prioritized recommendation run from CEO/Night Shift context (persisted as `nightshift_summary` and event stream).
4. Inbound email webhook with project reply-address mapping.
5. Per-company integrations config table with encrypted secrets and runtime resolution.
6. Per-company recurring tasks with cron + timezone and scheduler worker execution.
7. Per-company analytics/payments event entities and KPI summaries for nightshift reasoning.
8. Asset preview auth ownership patch.

### 3.2 Data model additions
- `project_events`
  - append-only timeline for all significant company state changes.
  - fields: `project_id`, `event_type`, `message`, `data`, `created_at`.

- `project_integrations`
  - provider-scoped project config.
  - fields: `project_id`, `provider`, `enabled`, `config_encrypted`, `config_masked`, timestamps.
  - unique: `(project_id, provider)`.

- `project_email_identities`
  - per-project reply address mapping.
  - fields: `project_id`, `reply_address`, `provider`, `status`, metadata.

- `inbound_email_messages`
  - normalized inbound email store.
  - fields: `project_id`, `email_identity_id`, `provider`, provider message id, sender/recipient, subject, text/html, payload, status.

- `project_recurring_tasks`
  - per-company automation schedules.
  - fields: `project_id`, `task_key`, `cron_expr`, `timezone`, `job_type`, `agent_key`, `payload`, `priority`, `enabled`, `next_run_at`, `last_run_at`.

- `project_analytics_events`
  - per-company event ingestion for funnel/traffic/engagement signals.

- `project_payment_events`
  - per-company billing/revenue events for KPI reasoning.

RLS: read policies tied to project ownership (`projects.owner_clerk_id`).

### 3.3 Canonical event ledger write map
Every source below MUST append to `project_events`:

- Chat:
  - user message received
  - assistant reply stored
- Approvals:
  - approved/denied/revised + actor + version
  - execution queued/started/completed/failed
- Assets:
  - upload URL requested
  - upload verified/completed
- Deploy/runtime actions:
  - deploy started/succeeded/failed
- Email:
  - outbound sent/failed
  - inbound received/processed
- Jobs:
  - `agent_job_events` artifact/status mirrored as project-level ledger entries

Event envelope standard:
- `event_type`: namespaced (`chat.user_message`, `approval.decided`, `email.inbound.received`, `job.artifact`, etc.)
- `message`: human-readable single-line summary
- `data`: structured payload (ids, status, provider metadata, tool/action names)

### 3.4 Company context assembler
Create `assembleCompanyContext(projectId)` and use it in:
- chat reply handler
- nightshift cycle handler
- phase generation handlers (phase0 + phase1/2/3)

Assembler pulls and composes:
- latest phase packets + synopsis + deliverables
- recent project events
- recent approvals/tasks/job artifacts
- assets/deployments/action executions
- inbound/outbound email summaries
- analytics + payments KPI aggregates (7d/30d)
- long-term memory (`agent_memory`)

Output:
- structured object for models
- compact text summary for prompts

### 3.5 Inbound email architecture
Add route:
- `POST /api/email/inbound`

Behavior:
- verify webhook secret/signature
- parse provider payload
- resolve project via `project_email_identities.reply_address`
- insert `inbound_email_messages`
- append `project_events`
- optionally mirror into `project_chat_messages` as `system` message for continuity

Outbound behavior update:
- for project-scoped sends, set `reply_to` to mapped project reply address when available

### 3.6 Per-company integrations runtime resolution
Add encrypted integration resolver:
- `resolveIntegration(projectId, provider)`:
  - try enabled project integration first
  - fallback to current global env credentials

Providers in scope:
- `resend`, `meta`, `github`, `vercel`

Encryption:
- AES-GCM with `PROJECT_INTEGRATION_ENCRYPTION_KEY`
- store masked safe preview in `config_masked`

### 3.7 Recurring automation
Add worker job type:
- `scheduler.run_recurring`

Behavior:
- scan `project_recurring_tasks` where `enabled=true` and `next_run_at <= now()`
- enqueue mapped job with deterministic idempotency key
- advance `next_run_at` using `cron_expr` + `timezone`
- write project event entries for each run
- include a default nightly recurring task per company (`nightly_context_prioritization`) that triggers `nightshift.cycle_project`
- every nightly cycle must output prioritized recommendations (top actions ranked) and persist:
  - `tasks`: `agent='night_shift'`, `description='nightshift_summary'`
  - `project_events`: `nightshift.recommendations_generated`

### 3.8 Analytics/payments ingestion + KPI summaries
Add routes:
- `POST /api/projects/[projectId]/analytics/events`
- `POST /api/projects/[projectId]/payments/events`

Nightshift and chat context consume KPI snapshot:
- traffic (7d/30d)
- lead events (7d/30d)
- conversion proxy (lead/traffic)
- succeeded payments count
- revenue cents (7d/30d)

Goal: nightshift reasoning is not packet-only; it can react to live business performance.

### 3.9 Security patch
Patch:
- `GET /api/projects/[projectId]/assets/[assetId]/preview`

Required checks:
- authenticated user
- project exists and belongs to caller
- asset belongs to project

### 3.10 Phase 1 rollout order
1. Migrations + RLS.
2. Core libs (`project-events`, `company-context`, `integration-resolver`, cron scheduler utilities).
3. Route/worker write-path wiring.
4. Inbound email route + email identity provisioning on project create.
5. Analytics/payments ingestion.
6. Security patch + tests + typecheck.

### 3.11 Phase 1 acceptance criteria
- Any significant project operation appears in `project_events` within same request/job.
- Chat can reference inbound emails and recent artifacts without manual copy/paste.
- Nightshift prompt includes KPI summary from analytics/payments entities.
- Per-project integration config works and falls back to global env when absent.
- At least one recurring task can enqueue/execute correctly on schedule.
- Asset preview route rejects non-owner access.

## 4) Phase 2 - Post-Payment Provisioning (Dedicated Company Runtime)

### 4.1 Trigger
Provisioning starts only after payment activation event:
- subscription active, or
- trial converts to paid, or
- manual admin activation.

### 4.2 Outcome
Each paid company gets a provisioned runtime bundle:
- dedicated runtime target (service/app instance)
- dedicated repo (or dedicated branch policy if repo constrained)
- dedicated DB (Neon preferred first)
- dedicated schedules/automation scope
- dedicated integration config namespace

### 4.3 Data model additions
- `project_runtime_instances`
  - `project_id`, `status`, `mode` (`shared|provisioning|dedicated`), provider IDs, endpoints, repo/db refs.
- `project_provisioning_jobs`
  - step-by-step state machine records with retries/errors.
- `project_runtime_secrets`
  - references to secret manager keys (no plaintext).

### 4.4 Provisioning workflow (worker-orchestrated)
New job type:
- `runtime.provision_project`

Steps:
1. Mark project runtime mode `provisioning`.
2. Provision code container/repo target.
3. Provision Neon DB and run migrations.
4. Provision app runtime service and attach env/secrets.
5. Seed default recurring tasks and email identity.
6. Health-check runtime.
7. Flip runtime mode to `dedicated`.
8. Emit completion event + notify user.

### 4.5 Failure model
- Step retries with capped attempts.
- Partial resource tracking for cleanup.
- If irrecoverable:
  - set status `failed`
  - remain on shared runtime
  - emit actionable failure event.

### 4.6 Control-plane behavior during/after provisioning
- During provisioning:
  - chat and tasking still run on shared plane, flagged with provisioning status.
- After dedicated activation:
  - execution-capable jobs route through dedicated runtime context.
  - project-level integrations default to dedicated credentials/config.

### 4.7 Performance/cost expectations
Benefits expected for paid companies:
- reduced noisy-neighbor impact
- clearer cost attribution per company
- stronger autonomy boundaries for tools/actions

Tradeoff:
- higher per-company baseline infrastructure cost vs shared mode.

### 4.8 Phase 2 acceptance criteria
- Paid project transitions `shared -> provisioning -> dedicated` deterministically.
- Dedicated runtime can execute at least: deploy action, scheduled task, outbound email using project-scoped config.
- Shared fallback remains available if dedicated runtime fails.

## 5) Delivery sequence
- Milestone A: Phase 1 complete and live behind feature flags.
- Milestone B: Pilot Phase 2 provisioning on internal/test companies.
- Milestone C: Enable post-payment auto-provisioning for production cohorts.

## 6) Suggested flags
- `FEATURE_PROJECT_EVENTS`
- `FEATURE_COMPANY_CONTEXT_ASSEMBLER`
- `FEATURE_PROJECT_INBOUND_EMAIL`
- `FEATURE_PROJECT_INTEGRATIONS`
- `FEATURE_PROJECT_RECURRING_TASKS`
- `FEATURE_PROJECT_KPI_INGESTION`
- `FEATURE_POST_PAYMENT_PROVISIONING`

## 7) Open decisions needed before Phase 2 implementation
1. Provisioning target preference for dedicated runtime: Render service vs Vercel isolated project strategy.
2. Repo strategy: dedicated repo per company vs mono-template + per-company branch.
3. Secret manager source of truth for dedicated runtimes.
4. Billing event source of truth for activation (Stripe webhook route contract).
