# Greenlight Studio -- Implementation Diff Plan (Exact Files + Before/After)

**Purpose:** This is the "do-this-next" companion to `greenlightstudio-polsia-refactor-spec.md`.  
**Audience:** Codex / implementation agent working in `msanchezgrice/greenlightstudio`.  
**Goal:** Provide an explicit file-by-file refactor plan with concrete before/after logic, pseudocode, and sequencing so the implementation doesn't drift.

---

## 1) High-level approach (keep Vercel UI, move work to worker)

**Keep on Vercel**
- Next.js UI + Clerk auth
- API routes that validate permissions and *enqueue jobs* only
- SSE stream endpoint for real-time project activity

**Add a Worker service (Render background worker)**
- Node/TS process that claims jobs from Supabase and executes them
- Emits `agent_job_events` so the UI can stream activity
- Runs Claude Agent SDK and all heavy integrations (email send, deploy, night cycles)

---

## 2) New DB migration files (exact names)

### 2.1 Add: `supabase/migrations/20260227_agent_jobs.sql`
Use the SQL from the prior spec (sentinel system project + agent_jobs + agent_job_events + claim RPC + complete RPC + reclaim_stale_jobs RPC + execution columns + idempotency index).

### 2.2 (Optional) Add: `supabase/migrations/20260227_project_events.sql`
Only if you want a second unified feed table. Not required.

### 2.3 After migration: run `supabase gen types typescript` to update TypeScript types for the new tables.

---

## 3) New source files to add

### 3.1 Jobs enqueue + helpers
Create directory:

```
src/lib/jobs/
  constants.ts
  enqueue.ts
  idempotency.ts
```

#### `src/lib/jobs/constants.ts`
- Define job types, agent keys, priorities, sentinel project UUID.
```ts
export const SYSTEM_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

export const JOB_TYPES = {
  PHASE0: "phase0.generate_packet",
  PHASE_GEN: "phase.generate_packet",
  APPROVAL_EXEC: "approval.execute",
  EMAIL_DUE: "email.process_due",
  DRIP_DIGESTS: "drip.process_digests",
  DRIP_NUDGES: "drip.process_nudges",
  NIGHTSHIFT: "nightshift.cycle_project",
  CHAT_REPLY: "chat.reply",
  CODE_GEN_MVP: "code.generate_mvp",
  RESEARCH_REPORT: "research.generate_report",
  BROWSER_CHECK: "browser.check_page",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export const AGENT_KEYS = {
  CEO: "ceo",
  RESEARCH: "research",
  DESIGN: "design",
  ENGINEERING: "engineering",
  NIGHTSHIFT: "night_shift",
  OUTREACH: "outreach",
  SYSTEM: "system",
} as const;

export const PRIORITY = {
  USER_BLOCKING: 100,
  USER_INTERACTIVE: 80,
  DEFAULT: 50,
  BACKGROUND: 10,
} as const;
```

#### `src/lib/jobs/idempotency.ts`
- Hash helpers to build idempotency keys.
```ts
import crypto from "node:crypto";

export function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function stableStringify(value: unknown) {
  return JSON.stringify(value, Object.keys(value as any).sort());
}
```

#### `src/lib/jobs/enqueue.ts`
- Inserts into `agent_jobs` with `(project_id, idempotency_key)` uniqueness.
- On unique violation (`error.code === '23505'`), fetch the existing job and return its id.
- Other errors propagate as real failures.
```ts
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export async function enqueueJob(input: {
  projectId: string;
  jobType: string;
  agentKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  priority?: number;
  runAfter?: string; // ISO
}) {
  const db = createServiceSupabase();
  const row = {
    project_id: input.projectId,
    job_type: input.jobType,
    agent_key: input.agentKey,
    payload: input.payload,
    idempotency_key: input.idempotencyKey,
    priority: input.priority ?? 0,
    run_after: input.runAfter ?? new Date().toISOString(),
    status: "queued",
  };

  const insert = await withRetry(() =>
    db.from("agent_jobs").insert(row).select("id").maybeSingle()
  );

  if (insert.data?.id) return insert.data.id as string;

  // Only treat unique violation as idempotency conflict
  if (insert.error?.code === "23505") {
    const existing = await withRetry(() =>
      db.from("agent_jobs")
        .select("id")
        .eq("project_id", input.projectId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle()
    );
    if (existing.data?.id) return existing.data.id as string;
  }

  throw new Error(insert.error?.message ?? "Failed to enqueue job");
}
```

---

### 3.2 Worker runtime
Create directory:

```
src/worker/
  index.ts
  worker-config.ts
  supabase-admin.ts
  job-events.ts
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
```

#### `src/worker/supabase-admin.ts`
```ts
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

export function createAdminSupabase() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}
```

#### `src/worker/job-events.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function emitJobEvent(db: SupabaseClient, input: {
  projectId: string;
  jobId: string;
  type: "status" | "log" | "delta" | "tool_call" | "tool_result" | "artifact";
  message?: string;
  data?: Record<string, unknown>;
}) {
  await db.from("agent_job_events").insert({
    project_id: input.projectId,
    job_id: input.jobId,
    type: input.type,
    message: input.message ?? null,
    data: input.data ?? {},
  });
}
```

#### `src/worker/worker-config.ts`
```ts
export function getWorkerConfig() {
  return {
    workerId: process.env.WORKER_ID ?? "worker-local",
    concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3)),
    pollMs: Math.max(250, Number(process.env.WORKER_POLL_MS ?? 1000)),
    claimBatch: Math.max(1, Number(process.env.WORKER_CLAIM_BATCH ?? 5)),
    reclaimIntervalMs: Math.max(10_000, Number(process.env.WORKER_RECLAIM_INTERVAL_MS ?? 60_000)),
  };
}
```

#### `src/worker/job-handlers/index.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { handlePhase0Generate } from "./phase0-generate";
import { handlePhaseGenerate } from "./phase-generate";
import { handleApprovalExecute } from "./approval-execute";
import { handleEmailProcessDue } from "./email-process-due";
import { handleDripProcessDigests } from "./drip-process-digests";
import { handleDripProcessNudges } from "./drip-process-nudges";
import { handleNightshiftCycleProject } from "./nightshift-cycle-project";
import { handleChatReply } from "./chat-reply";
import { handleCodeGenerateMvp } from "./code-generate-mvp";
import { handleResearchGenerateReport } from "./research-generate-report";
import { handleBrowserCheckPage } from "./browser-check-page";

export type JobRow = {
  id: string;
  project_id: string;
  job_type: string;
  agent_key: string;
  payload: any;
  attempts: number;
  max_attempts: number;
};

export function getHandler(jobType: string) {
  switch (jobType) {
    case "phase0.generate_packet": return handlePhase0Generate;
    case "phase.generate_packet": return handlePhaseGenerate;
    case "approval.execute": return handleApprovalExecute;
    case "email.process_due": return handleEmailProcessDue;
    case "drip.process_digests": return handleDripProcessDigests;
    case "drip.process_nudges": return handleDripProcessNudges;
    case "nightshift.cycle_project": return handleNightshiftCycleProject;
    case "chat.reply": return handleChatReply;
    case "code.generate_mvp": return handleCodeGenerateMvp;
    case "research.generate_report": return handleResearchGenerateReport;
    case "browser.check_page": return handleBrowserCheckPage;
    default:
      return null;
  }
}
```

#### `src/worker/index.ts` (poll + claim + concurrency + graceful shutdown)
```ts
import { createAdminSupabase } from "./supabase-admin";
import { getWorkerConfig } from "./worker-config";
import { getHandler, type JobRow } from "./job-handlers";
import { emitJobEvent } from "./job-events";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

let shuttingDown = false;

async function runOnce() {
  const db = createAdminSupabase();
  const cfg = getWorkerConfig();

  const claim = await db.rpc("claim_agent_jobs", { p_worker_id: cfg.workerId, p_limit: cfg.claimBatch });
  const jobs = (claim.data ?? []) as JobRow[];
  if (!jobs.length) return { ran: 0 };

  let idx = 0;
  const workers = Array.from({ length: cfg.concurrency }).map(async () => {
    while (idx < jobs.length && !shuttingDown) {
      const job = jobs[idx++];
      const handler = getHandler(job.job_type);

      if (!handler) {
        await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "failed: unknown job_type" });
        await db.rpc("complete_agent_job", { p_job_id: job.id, p_status: "failed", p_error: `Unknown job_type ${job.job_type}` });
        continue;
      }

      try {
        await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "running" });
        await handler(db, job);
        await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "completed" });
        await db.rpc("complete_agent_job", { p_job_id: job.id, p_status: "completed", p_error: null });
      } catch (err: any) {
        const msg = err?.message ?? "Job failed";
        await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "failed", data: { error: msg } });

        const retriable = job.attempts < job.max_attempts;
        await db.rpc("complete_agent_job", { p_job_id: job.id, p_status: "failed", p_error: msg });

        if (retriable) {
          const runAfter = new Date(Date.now() + 30_000 * Math.max(1, job.attempts)).toISOString();
          await db.from("agent_jobs").update({ status: "queued", run_after: runAfter, completed_at: null }).eq("id", job.id);
        }
      }
    }
  });

  await Promise.all(workers);
  return { ran: jobs.length };
}

async function main() {
  const cfg = getWorkerConfig();
  console.log(`[worker] starting id=${cfg.workerId} concurrency=${cfg.concurrency} pollMs=${cfg.pollMs}`);

  process.on("SIGTERM", () => {
    console.log("[worker] SIGTERM received, draining...");
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    console.log("[worker] SIGINT received, draining...");
    shuttingDown = true;
  });

  let lastReclaim = 0;

  while (!shuttingDown) {
    const now = Date.now();
    if (now - lastReclaim > cfg.reclaimIntervalMs) {
      const db = createAdminSupabase();
      const result = await db.rpc("reclaim_stale_jobs");
      if (result.data && result.data > 0) {
        console.log(`[worker] reclaimed ${result.data} stale jobs`);
      }
      lastReclaim = now;
    }

    await runOnce();
    await sleep(cfg.pollMs);
  }

  console.log("[worker] shutdown complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

---

## 4) Job handler implementations (exact mapping to existing code)

### 4.1 `src/worker/job-handlers/phase0-generate.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { runPhase0, logPhase0Failure } from "@/lib/phase0";

export async function handlePhase0Generate(db: SupabaseClient, job: any) {
  const payload = job.payload ?? {};
  const projectId = payload.projectId ?? job.project_id;
  const ownerClerkId = payload.ownerClerkId;
  const revisionGuidance = payload.revisionGuidance ?? null;
  const forceNewApproval = Boolean(payload.forceNewApproval);

  await emitJobEvent(db, { projectId, jobId: job.id, type: "log", message: "phase0 init" });
  try {
    await emitJobEvent(db, { projectId, jobId: job.id, type: "log", message: "phase0 runPhase0 starting" });
    await runPhase0({ projectId, userId: ownerClerkId, revisionGuidance, forceNewApproval });
    await emitJobEvent(db, { projectId, jobId: job.id, type: "artifact", message: "phase0 packet generated" });
  } catch (e) {
    await logPhase0Failure(projectId, e);
    throw e;
  }
}
```

### 4.2 `src/worker/job-handlers/phase-generate.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { enqueueNextPhaseArtifacts } from "@/lib/phase-orchestrator";

export async function handlePhaseGenerate(db: SupabaseClient, job: any) {
  const payload = job.payload ?? {};
  const projectId = payload.projectId ?? job.project_id;
  const phase = Number(payload.phase);
  const forceRegenerate = Boolean(payload.forceRegenerate);
  const revisionGuidance = payload.revisionGuidance ?? null;

  await emitJobEvent(db, { projectId, jobId: job.id, type: "log", message: `phase${phase} enqueue artifacts` });
  await enqueueNextPhaseArtifacts(projectId, phase as 1|2|3, { forceRegenerate, revisionGuidance });
  await emitJobEvent(db, { projectId, jobId: job.id, type: "artifact", message: `phase${phase} packet generated` });
}
```

### 4.3 `src/worker/job-handlers/email-process-due.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { processDueEmailJobs } from "@/lib/action-execution";

export async function handleEmailProcessDue(db: SupabaseClient, job: any) {
  const payload = job.payload ?? {};
  const limit = Math.max(1, Number(payload.limit ?? 100));
  const projectId = job.project_id; // sentinel system project UUID

  const summary = await processDueEmailJobs(limit);
  await emitJobEvent(db, { projectId, jobId: job.id, type: "artifact", message: "email processed", data: summary });
}
```

### 4.4 `src/worker/job-handlers/drip-process-digests.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { processWeeklyDigests } from "@/lib/drip-emails";

export async function handleDripProcessDigests(db: SupabaseClient, job: any) {
  const projectId = job.project_id; // sentinel system project UUID

  const summary = await processWeeklyDigests();
  await emitJobEvent(db, { projectId, jobId: job.id, type: "artifact", message: "weekly digests processed", data: summary ?? {} });
}
```

### 4.5 `src/worker/job-handlers/drip-process-nudges.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { processNudgeEmails } from "@/lib/drip-emails";

export async function handleDripProcessNudges(db: SupabaseClient, job: any) {
  const projectId = job.project_id; // sentinel system project UUID

  const summary = await processNudgeEmails();
  await emitJobEvent(db, { projectId, jobId: job.id, type: "artifact", message: "nudge emails processed", data: summary ?? {} });
}
```

### 4.6 `src/worker/job-handlers/approval-execute.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { executeApprovedAction } from "@/lib/action-execution";

export async function handleApprovalExecute(db: SupabaseClient, job: any) {
  const payload = job.payload ?? {};
  const approvalId = payload.approvalId;
  const projectId = payload.projectId ?? job.project_id;

  // idempotency: if action_executions already contains completed entry for this approval, skip.
  const existing = await db.from("action_executions").select("id,status").eq("approval_id", approvalId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.data?.status === "completed") {
    await emitJobEvent(db, { projectId, jobId: job.id, type: "log", message: "already executed; skipping" });
    await db.from("approval_queue").update({ execution_status: "completed" }).eq("id", approvalId);
    return;
  }

  await db.from("approval_queue").update({ execution_status: "running" }).eq("id", approvalId);

  const approval = await db.from("approval_queue").select("id,project_id,action_type,payload").eq("id", approvalId).single();
  if (approval.error || !approval.data) throw new Error("Approval not found");

  const project = await db.from("projects").select("id,name,domain,repo_url,owner_clerk_id,runtime_mode,phase,permissions").eq("id", approval.data.project_id).single();
  if (project.error || !project.data) throw new Error("Project not found");

  const owner = await db.from("users").select("email").eq("clerk_id", project.data.owner_clerk_id).maybeSingle();

  await emitJobEvent(db, { projectId, jobId: job.id, type: "log", message: `executing ${approval.data.action_type}` });

  const appBaseUrl = process.env.APP_BASE_URL ?? "https://YOUR_VERCEL_DOMAIN";
  await executeApprovedAction({
    approval: {
      id: approval.data.id,
      project_id: approval.data.project_id,
      action_type: approval.data.action_type,
      payload: (approval.data.payload as any) ?? null,
    },
    project: {
      id: project.data.id,
      name: project.data.name,
      domain: project.data.domain,
      repo_url: project.data.repo_url,
      owner_clerk_id: project.data.owner_clerk_id,
      runtime_mode: project.data.runtime_mode,
      phase: project.data.phase,
      permissions: (project.data.permissions as any) ?? null,
    },
    ownerEmail: (owner.data?.email as string | null) ?? null,
    appBaseUrl,
  });

  await db.from("approval_queue").update({ execution_status: "completed" }).eq("id", approvalId);
  await emitJobEvent(db, { projectId, jobId: job.id, type: "artifact", message: "approval executed" });
}
```

### 4.7 `src/worker/job-handlers/nightshift-cycle-project.ts`
Port `src/app/api/nightshift/run/route.ts` project loop into one job. Key: no loops inside handler besides per-action.

- Read pending approvals
- Read latest packet
- Derive actions via existing `deriveNightShiftActions` from `@/lib/nightshift`
- Queue execution approvals using the same insert logic

### 4.8 `src/worker/job-handlers/chat-reply.ts` (ephemeral streaming)
This is the most important "alive" user-facing improvement.

**Implementation plan (ephemeral-only -- no placeholder DB row):**
1) Load chat context (same as current route: messages, packet, tasks, approvals)
2) Call `generateProjectChatReply(input, { onTextDelta })` with the new streaming callback
3) Throttle delta events: emit `delta` job events every ~250ms / ~500 chars
4) On completion: INSERT the final assistant message into `project_chat_messages` (same as current behavior)
5) The UI renders streaming deltas from SSE in client state only; no DB row updates during streaming

---

## 5) API routes: exact changes with before/after

### 5.1 `src/app/api/projects/[projectId]/launch/route.ts`
**Before**
- Validates auth
- Prevents duplicate by scanning `tasks` in last 20 min
- Uses `after(() => runPhase0(...))`
- Returns `{ started: true }`

**After**
- Validates auth
- Prevent duplicates by checking existing job idempotency and/or existing phase0 packet
- Enqueue `agent_jobs` row and return `jobId`
- No `after()`, no agent calls

Pseudo:
```ts
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";
import { sha1 } from "@/lib/jobs/idempotency";

const idem = `phase0:${projectId}:${sha1(revisionGuidance ?? "")}:${forceNewApproval ? "1":"0"}`;
const jobId = await enqueueJob({
  projectId,
  jobType: JOB_TYPES.PHASE0,
  agentKey: AGENT_KEYS.CEO,
  payload: { projectId, ownerClerkId: runAsUserId, revisionGuidance, forceNewApproval },
  idempotencyKey: idem,
  priority: PRIORITY.USER_BLOCKING,
});
return NextResponse.json({ ok: true, started: true, jobId });
```

### 5.2 `src/app/api/inbox/[approvalId]/decision/route.ts`
**Before**
- For executable actions, calls `executeApprovedAction(...)` inline
- Updates approval row
- For phase-advance, calls `enqueueNextPhaseArtifacts` inline in try/catch

**After**
- Never execute inline
- On executable approval: mark `execution_status='queued'` and enqueue `approval.execute`
- On phase advance approval: enqueue `phase.generate_packet` for next phase
- Return quickly

Pseudo:
```ts
if (decision === "approved" && executableActions.has(row.action_type)) {
  const execJobId = await enqueueJob({
    projectId: row.project_id,
    jobType: JOB_TYPES.APPROVAL_EXEC,
    agentKey: AGENT_KEYS.ENGINEERING,
    payload: { approvalId, projectId: row.project_id, actionType: row.action_type },
    idempotencyKey: `approval:${approvalId}`,
    priority: PRIORITY.USER_BLOCKING,
  });
  await db.from("approval_queue").update({ execution_status: "queued", execution_job_id: execJobId }).eq("id", approvalId);
}

if (decision === "approved" && phaseAdvanceActions.has(row.action_type)) {
  const nextPhase = Math.max(project.phase, row.phase) + 1;
  await update_phase(...)

  const genJobId = await enqueueJob({
    projectId: row.project_id,
    jobType: JOB_TYPES.PHASE_GEN,
    agentKey: AGENT_KEYS.CEO,
    payload: { projectId: row.project_id, phase: nextPhase },
    idempotencyKey: `phasegen:${row.project_id}:${nextPhase}`,
    priority: PRIORITY.DEFAULT,
  });
}
```

> **Important:** The idempotency key for phase generation uses `phasegen:{projectId}:{phase}` -- a stable key. Do NOT include `Date.now()` as it defeats idempotency (two rapid clicks would create duplicate jobs).

### 5.3 `src/app/api/nightshift/run/route.ts`
**Before**
- Auth by CRON secret
- `processDueEmailJobs(100)` inline
- `processWeeklyDigests()` and `processNudgeEmails()` inline
- Loops up to 50 projects and derives actions inline

**After**
- Auth by CRON secret
- Enqueue 1 job `email.process_due` (sentinel system project)
- Enqueue 1 job `drip.process_digests` (sentinel system project)
- Enqueue 1 job `drip.process_nudges` (sentinel system project)
- For each night_shift project enqueue `nightshift.cycle_project`
- Return JSON: `{ queuedProjects, queuedEmailJob, queuedDripDigests, queuedDripNudges }`

Pseudo:
```ts
import { SYSTEM_PROJECT_ID, JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";

const YYYYMMDDHH = new Date().toISOString().slice(0, 13);
const YYYYMMDD = new Date().toISOString().slice(0, 10);

const emailJobId = await enqueueJob({
  projectId: SYSTEM_PROJECT_ID,
  jobType: JOB_TYPES.EMAIL_DUE,
  agentKey: AGENT_KEYS.OUTREACH,
  payload: { limit: 100 },
  idempotencyKey: `email_due:${YYYYMMDDHH}`,
  priority: PRIORITY.BACKGROUND,
});

const digestJobId = await enqueueJob({
  projectId: SYSTEM_PROJECT_ID,
  jobType: JOB_TYPES.DRIP_DIGESTS,
  agentKey: AGENT_KEYS.OUTREACH,
  payload: {},
  idempotencyKey: `drip_digests:${YYYYMMDD}`,
  priority: PRIORITY.BACKGROUND,
});

const nudgeJobId = await enqueueJob({
  projectId: SYSTEM_PROJECT_ID,
  jobType: JOB_TYPES.DRIP_NUDGES,
  agentKey: AGENT_KEYS.OUTREACH,
  payload: {},
  idempotencyKey: `drip_nudges:${YYYYMMDD}`,
  priority: PRIORITY.BACKGROUND,
});

for (const project of projects) {
  await enqueueJob({
    projectId: project.id,
    jobType: JOB_TYPES.NIGHTSHIFT,
    agentKey: AGENT_KEYS.NIGHTSHIFT,
    payload: { projectId: project.id },
    idempotencyKey: `nightshift:${project.id}:${YYYYMMDD}`,
    priority: PRIORITY.BACKGROUND,
  });
}
```

### 5.4 `src/app/api/projects/[projectId]/chat/route.ts`
**Before**
- POST inserts user msg
- loads context, calls `generateProjectChatReply` inline, inserts assistant msg, returns

**After**
- POST inserts user msg
- enqueue `chat.reply` job with idempotency `chat:{projectId}:{userMsgId}`
- returns `{ ok: true, jobId }`
- GET unchanged

---

## 6) Add SSE endpoint file (exact)

Create: `src/app/api/projects/[projectId]/events/route.ts`

Implementation requirements:
- Clerk auth
- Verify project belongs to user
- SSE headers:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
- Cursor:
  - client sends `?after=<iso>&afterId=<uuid>` or `?cursor=<base64>`
- Server loops for ~25s:
  - query new `agent_job_events` after cursor
  - write `event: message` lines with JSON payload
  - send keepalive ping every ~5s
- Close so browser reconnects automatically

---

## 7) Modify Claude Agent SDK wrapper for streaming (exact changes)

File: `src/lib/agent.ts`

### 7.1 Add optional delta callback to `executeQueryAttempt`

**Current signature (5 params):**
```ts
async function executeQueryAttempt<T>(
  prompt: string,
  options: QueryAttemptOptions<T>,
  profile: QueryProfile,
  agentProfile: AgentProfile = AGENT_PROFILES.none,
  traceTarget?: TraceTarget
)
```

**New signature (add 6th param):**
```ts
async function executeQueryAttempt<T>(
  prompt: string,
  options: QueryAttemptOptions<T>,
  profile: QueryProfile,
  agentProfile: AgentProfile = AGENT_PROFILES.none,
  traceTarget?: TraceTarget,
  hooks?: { onTextDelta?: (delta: string) => void }
)
```

In the `stream_event` branch:
```ts
if (message.type === "stream_event") {
  const d = extractDeltaText(message.event);
  if (d) hooks?.onTextDelta?.(d);
  streamedRaw += d;
  streamedJsonRaw += extractJsonDelta(message.event);
  continue;
}
```

Then thread hooks through `runJsonQuery` and `generateProjectChatReply`:
- Add a second argument to `generateProjectChatReply(input, hooks?)`
- Use hooks only for the chat path, not packet JSON paths (those stay strict JSON).

---

## 8) UI changes (exact files)

### 8.1 `src/components/project-chat-pane.tsx`
Current behavior:
- POST waits; then reloadMessages()

New behavior:
- POST returns jobId
- Start an EventSource to `/api/projects/${projectId}/events`
- Filter events where `data.job_id === jobId` and `type === "delta"`
- Render streamed assistant bubble immediately (ephemeral client state)
- When `type === "status"` and message == "completed", call `reloadMessages()`

Minimal implementation approach:
- Add local state: `streamingAssistant: string | null`
- On submit: set `streamingAssistant = ""`
- On delta: append to `streamingAssistant`
- Render the assistant message at bottom while streaming
- On completion: clear streamingAssistant and reload

### 8.2 Tasks/Board live feed
Optional but recommended:
- Add `src/components/live-activity-ticker.tsx`
- Uses EventSource to `/api/projects/${projectId}/events` or a new `/api/events` endpoint that streams across all owned projects.
- Display "CEO researching...", "Deploy completed...", etc.

---

## 9) Where to keep existing `tasks` and `task_log`

Do NOT delete them in this PR. They're used throughout UI (9+ components).  
But start migrating "alive state" to job events:

- Keep writing `log_task` for backward compatibility.
- UI can gradually move from `tasks` to `agent_job_events`.
- Keep `LiveRefresh` component active for non-SSE pages.
- Eventually migrate `agents/live` endpoint to query `agent_jobs` instead of `tasks`.

---

## 10) Integration tests to add (minimal, high value)

Create:
- `tests/integration/agent_jobs.test.ts`

Test cases:
1) Enqueue idempotency: same `(projectId, idempotencyKey)` returns same job id.
2) Approval execute idempotency: if `action_executions` exists for approval_id, handler skips without side effects.
3) Claim RPC: two concurrent claimers don't get same jobs.
4) Stale lock recovery: job with old `locked_at` gets reclaimed.

---

## 11) Implementation sequence (to avoid breaking prod)

1) **DB migrations + enqueue helper + sentinel system project + agent_memory table**  
2) **Worker skeleton that only logs events** (no real execution)  
3) Move Phase0 launch route to enqueue (worker runs Phase0)  
4) Move approvals execution to worker  
5) Add SSE endpoint  
6) Update chat to enqueue + stream (ephemeral deltas)  
7) Convert nightshift to enqueue per project + drip email jobs  
8) Add agent memory system (load/write/format helpers)  
9) Add code.generate_mvp handler + code_generator agent profile  
10) Add research.generate_report handler + researcher_report agent profile  
11) Add browser.check_page handler (Playwright)  

---

## 12) "Done" definition (what you should see)

- Clicking "Launch Phase 0" returns quickly and UI shows streaming events
- Phase0 packet appears after worker completes
- Approving deploy/email runs async and shows events; no timeouts
- Night shift cron enqueues jobs; jobs execute in worker (including drip digests and nudges)
- Chat shows live typing/deltas (not a 30-180s blank wait)
- code.generate_mvp produces files, commits to GitHub, triggers deploy
- research.generate_report produces a downloadable PowerPoint/PDF in Supabase Storage
- browser.check_page screenshots a deployed page and reports QA results
- Agent memory persists across runs -- subsequent agent calls are enriched with prior context
- Crashed worker's jobs are reclaimed within 10 minutes
- Graceful shutdown completes in-flight work on redeploy
