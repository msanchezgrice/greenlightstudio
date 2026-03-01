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
import { handleBrainRefresh } from "./brain-refresh";
import { handleSchedulerRunRecurring } from "./scheduler-run-recurring";
import { handleRuntimeProvisionProject } from "./runtime-provision-project";

export type JobRow = {
  id: string;
  project_id: string;
  job_type: string;
  agent_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export type JobHandler = (db: SupabaseClient, job: JobRow) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  "phase0.generate_packet": handlePhase0Generate,
  "phase.generate_packet": handlePhaseGenerate,
  "approval.execute": handleApprovalExecute,
  "email.process_due": handleEmailProcessDue,
  "drip.process_digests": handleDripProcessDigests,
  "drip.process_nudges": handleDripProcessNudges,
  "nightshift.cycle_project": handleNightshiftCycleProject,
  "chat.reply": handleChatReply,
  "code.generate_mvp": handleCodeGenerateMvp,
  "research.generate_report": handleResearchGenerateReport,
  "browser.check_page": handleBrowserCheckPage,
  "brain.refresh": handleBrainRefresh,
  "scheduler.run_recurring": handleSchedulerRunRecurring,
  "runtime.provision_project": handleRuntimeProvisionProject,
};

export function getHandler(jobType: string): JobHandler | null {
  return handlers[jobType] ?? null;
}
