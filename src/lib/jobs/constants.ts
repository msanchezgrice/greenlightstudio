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
  BRAIN_REFRESH: "brain.refresh",
  SCHEDULER_RUN_RECURRING: "scheduler.run_recurring",
  RUNTIME_PROVISION: "runtime.provision_project",
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
  BRAIN: "brain",
  PROVISIONER: "provisioner",
} as const;

export const PRIORITY = {
  REALTIME: 120,
  USER_BLOCKING: 100,
  USER_INTERACTIVE: 80,
  DEFAULT: 50,
  BACKGROUND: 10,
} as const;
