import { createServiceSupabase } from "@/lib/supabase";
import { sendResendEmail } from "@/lib/integrations";
import { withRetry } from "@/lib/retry";
import {
  welcomeEmail,
  phase0ReadyEmail,
  phase1ReadyEmail,
  weeklyDigestEmail,
  nudgeNoReviewsEmail,
  nudgeNoSignoffsEmail,
} from "@/lib/email-templates";

function normalizeEnvValue(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\\r/g, "").replace(/\\n/g, "").trim();
  return value || null;
}

function isResendConfigured() {
  return Boolean(normalizeEnvValue(process.env.RESEND_API_KEY) && normalizeEnvValue(process.env.RESEND_FROM_EMAIL));
}

function getAppBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

type DripResult = { sent: boolean; reason?: string };

let missingDripLogWarned = false;

function isMissingDripLogError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "PGRST205" || code === "42P01";
}

function isUniqueViolation(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "23505";
}

function formatDbError(error: unknown, fallback = "Database query failed") {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? fallback);
  }
  return fallback;
}

function warnMissingDripLog() {
  if (missingDripLogWarned) return;
  missingDripLogWarned = true;
  console.warn("[drip] drip_email_log table missing; sends will continue without dedupe logging.");
}

async function getDripCount(query: () => PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await withRetry(() => Promise.resolve(query()));
  if (result.error) {
    if (isMissingDripLogError(result.error)) {
      warnMissingDripLog();
      return 0;
    }
    throw new Error(formatDbError(result.error, "Failed reading drip dedupe log"));
  }
  return result.count ?? 0;
}

async function recordDrip(input: {
  userId: string;
  emailType: string;
  projectId: string | null;
  digestWeek: string | null;
  toEmail: string;
  subject: string;
  resendMessageId: string | null;
  status: "sent" | "failed";
  error: string | null;
}) {
  const db = createServiceSupabase();
  const insertResult = await withRetry(() =>
    db.from("drip_email_log").insert({
      user_id: input.userId,
      email_type: input.emailType,
      project_id: input.projectId,
      digest_week: input.digestWeek,
      to_email: input.toEmail,
      subject: input.subject,
      resend_message_id: input.resendMessageId,
      status: input.status,
      error: input.error,
    }),
  );
  if (insertResult.error) {
    if (isMissingDripLogError(insertResult.error)) {
      warnMissingDripLog();
      return;
    }
    if (!isUniqueViolation(insertResult.error)) {
      throw new Error(formatDbError(insertResult.error, "Failed writing drip log"));
    }

    // Retry path: update existing row (created by a prior failed attempt) instead of dropping the new result.
    let updateQuery = db
      .from("drip_email_log")
      .update({
        to_email: input.toEmail,
        subject: input.subject,
        resend_message_id: input.resendMessageId,
        status: input.status,
        error: input.error,
      })
      .eq("user_id", input.userId)
      .eq("email_type", input.emailType);

    updateQuery = input.projectId ? updateQuery.eq("project_id", input.projectId) : updateQuery.is("project_id", null);
    updateQuery = input.digestWeek ? updateQuery.eq("digest_week", input.digestWeek) : updateQuery.is("digest_week", null);

    const updateResult = await withRetry(() => updateQuery);
    if (updateResult.error && !isMissingDripLogError(updateResult.error)) {
      throw new Error(formatDbError(updateResult.error, "Failed updating existing drip log row"));
    }
  }
}

// ---------------------------------------------------------------------------
// Welcome email — called when user creates their first project
// ---------------------------------------------------------------------------

export async function sendWelcomeDrip(userId: string, email: string, projectName: string): Promise<DripResult> {
  if (!isResendConfigured()) return { sent: false, reason: "resend_not_configured" };

  const db = createServiceSupabase();
  const baseUrl = getAppBaseUrl();

  const alreadySent = await getDripCount(() =>
    db
      .from("drip_email_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("email_type", "welcome")
      .eq("status", "sent"),
  );
  if (alreadySent > 0) return { sent: false, reason: "already_sent" };

  const { subject, html } = welcomeEmail({ projectName, baseUrl });

  try {
    const result = await sendResendEmail({ to: email, subject, html });
    await recordDrip({
      userId,
      emailType: "welcome",
      projectId: null,
      digestWeek: null,
      toEmail: email,
      subject,
      resendMessageId: result.id,
      status: "sent",
      error: null,
    });
    return { sent: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Send failed";
    await recordDrip({
      userId,
      emailType: "welcome",
      projectId: null,
      digestWeek: null,
      toEmail: email,
      subject,
      resendMessageId: null,
      status: "failed",
      error: detail,
    }).catch(() => {});
    return { sent: false, reason: detail };
  }
}

// ---------------------------------------------------------------------------
// Phase 0 report ready — called after runPhase0 completes successfully
// ---------------------------------------------------------------------------

export async function sendPhase0ReadyDrip(input: {
  userId: string;
  email: string;
  projectId: string;
  projectName: string;
  confidence: number;
  recommendation: string;
}): Promise<DripResult> {
  if (!isResendConfigured()) return { sent: false, reason: "resend_not_configured" };

  const db = createServiceSupabase();
  const baseUrl = getAppBaseUrl();

  const alreadySent = await getDripCount(() =>
    db
      .from("drip_email_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId)
      .eq("email_type", "phase0_ready")
      .eq("status", "sent")
      .eq("project_id", input.projectId),
  );
  if (alreadySent > 0) return { sent: false, reason: "already_sent" };

  const { subject, html } = phase0ReadyEmail({
    projectName: input.projectName,
    confidence: input.confidence,
    recommendation: input.recommendation,
    projectId: input.projectId,
    baseUrl,
  });

  try {
    const result = await sendResendEmail({ to: input.email, subject, html });
    await recordDrip({
      userId: input.userId,
      emailType: "phase0_ready",
      projectId: input.projectId,
      digestWeek: null,
      toEmail: input.email,
      subject,
      resendMessageId: result.id,
      status: "sent",
      error: null,
    });
    return { sent: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Send failed";
    await recordDrip({
      userId: input.userId,
      emailType: "phase0_ready",
      projectId: input.projectId,
      digestWeek: null,
      toEmail: input.email,
      subject,
      resendMessageId: null,
      status: "failed",
      error: detail,
    }).catch(() => {});
    return { sent: false, reason: detail };
  }
}

// ---------------------------------------------------------------------------
// Phase 1 deliverables ready — called after phase1-deliverables completes
// ---------------------------------------------------------------------------

export async function sendPhase1ReadyDrip(input: {
  userId: string;
  email: string;
  projectId: string;
  projectName: string;
  landingUrl: string | null;
}): Promise<DripResult> {
  if (!isResendConfigured()) return { sent: false, reason: "resend_not_configured" };

  const db = createServiceSupabase();
  const baseUrl = getAppBaseUrl();

  const alreadySent = await getDripCount(() =>
    db
      .from("drip_email_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId)
      .eq("email_type", "phase1_ready")
      .eq("status", "sent")
      .eq("project_id", input.projectId),
  );
  if (alreadySent > 0) return { sent: false, reason: "already_sent" };

  const { subject, html } = phase1ReadyEmail({
    projectName: input.projectName,
    projectId: input.projectId,
    landingUrl: input.landingUrl,
    baseUrl,
  });

  try {
    const result = await sendResendEmail({ to: input.email, subject, html });
    await recordDrip({
      userId: input.userId,
      emailType: "phase1_ready",
      projectId: input.projectId,
      digestWeek: null,
      toEmail: input.email,
      subject,
      resendMessageId: result.id,
      status: "sent",
      error: null,
    });
    return { sent: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Send failed";
    await recordDrip({
      userId: input.userId,
      emailType: "phase1_ready",
      projectId: input.projectId,
      digestWeek: null,
      toEmail: input.email,
      subject,
      resendMessageId: null,
      status: "failed",
      error: detail,
    }).catch(() => {});
    return { sent: false, reason: detail };
  }
}

// ---------------------------------------------------------------------------
// Weekly digest — called from cron
// ---------------------------------------------------------------------------

export async function processWeeklyDigests(): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  if (!isResendConfigured()) return { processed: 0, sent: 0, skipped: 0, failed: 0 };

  const db = createServiceSupabase();
  const baseUrl = getAppBaseUrl();
  const currentWeek = getISOWeek(new Date());
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: users, error: usersError } = await withRetry(() =>
    db.from("users").select("id, email, clerk_id").not("email", "is", null),
  );
  if (usersError) throw new Error(usersError.message);

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users ?? []) {
    const userId = user.id as string;
    const email = user.email as string;
    const clerkId = user.clerk_id as string;
    if (!email || !clerkId) continue;
    processed += 1;

    const alreadySent = await getDripCount(() =>
      db
        .from("drip_email_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("email_type", "weekly_digest")
        .eq("status", "sent")
        .eq("digest_week", currentWeek),
    );
    if (alreadySent > 0) {
      skipped += 1;
      continue;
    }

    const { data: projects } = await withRetry(() =>
      db
        .from("projects")
        .select("id, name, phase")
        .eq("owner_clerk_id", clerkId)
        .order("created_at", { ascending: false })
        .limit(20),
    );
    if (!projects?.length) {
      skipped += 1;
      continue;
    }

    const projectIds = projects.map((p) => p.id as string);

    const { data: pendingApprovals } = await withRetry(() =>
      db.from("approval_queue").select("project_id").in("project_id", projectIds).eq("status", "pending"),
    );
    const pendingByProject = new Map<string, number>();
    for (const row of pendingApprovals ?? []) {
      const pid = row.project_id as string;
      pendingByProject.set(pid, (pendingByProject.get(pid) ?? 0) + 1);
    }

    const { data: recentTasks } = await withRetry(() =>
      db
        .from("tasks")
        .select("project_id, status")
        .in("project_id", projectIds)
        .gte("created_at", sevenDaysAgo),
    );
    const completedByProject = new Map<string, number>();
    const failedByProject = new Map<string, number>();
    for (const row of recentTasks ?? []) {
      const pid = row.project_id as string;
      if (row.status === "completed") completedByProject.set(pid, (completedByProject.get(pid) ?? 0) + 1);
      if (row.status === "failed") failedByProject.set(pid, (failedByProject.get(pid) ?? 0) + 1);
    }

    const { data: latestPackets } = await withRetry(() =>
      db
        .from("phase_packets")
        .select("project_id, confidence_score")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false }),
    );
    const confByProject = new Map<string, number>();
    for (const row of latestPackets ?? []) {
      const pid = row.project_id as string;
      if (!confByProject.has(pid) && typeof row.confidence_score === "number") {
        confByProject.set(pid, row.confidence_score);
      }
    }

    const digestProjects = projects.map((p) => ({
      name: p.name as string,
      projectId: p.id as string,
      phase: p.phase as number,
      pendingApprovals: pendingByProject.get(p.id as string) ?? 0,
      recentCompletedTasks: completedByProject.get(p.id as string) ?? 0,
      recentFailedTasks: failedByProject.get(p.id as string) ?? 0,
      latestConfidence: confByProject.get(p.id as string) ?? null,
    }));

    const totalPending = [...pendingByProject.values()].reduce((a, b) => a + b, 0);
    const hasActivity = totalPending > 0 || (recentTasks?.length ?? 0) > 0;
    if (!hasActivity) {
      skipped += 1;
      continue;
    }

    const { subject, html } = weeklyDigestEmail({ projects: digestProjects, totalPending, baseUrl });

    try {
      const result = await sendResendEmail({ to: email, subject, html });
      await recordDrip({
        userId,
        emailType: "weekly_digest",
        projectId: null,
        digestWeek: currentWeek,
        toEmail: email,
        subject,
        resendMessageId: result.id,
        status: "sent",
        error: null,
      });
      sent += 1;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Send failed";
      await recordDrip({
        userId,
        emailType: "weekly_digest",
        projectId: null,
        digestWeek: currentWeek,
        toEmail: email,
        subject,
        resendMessageId: null,
        status: "failed",
        error: detail,
      }).catch(() => {});
      failed += 1;
    }
  }

  return { processed, sent, skipped, failed };
}

// ---------------------------------------------------------------------------
// Nudge emails — called from cron
// ---------------------------------------------------------------------------

export async function processNudgeEmails(): Promise<{
  nudgeNoReviews: { sent: number; skipped: number; failed: number };
  nudgeNoSignoffs: { sent: number; skipped: number; failed: number };
}> {
  if (!isResendConfigured()) {
    return {
      nudgeNoReviews: { sent: 0, skipped: 0, failed: 0 },
      nudgeNoSignoffs: { sent: 0, skipped: 0, failed: 0 },
    };
  }

  const db = createServiceSupabase();
  const baseUrl = getAppBaseUrl();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

  const { data: users } = await withRetry(() =>
    db.from("users").select("id, email, clerk_id, created_at").not("email", "is", null).lte("created_at", threeDaysAgo),
  );

  const reviewStats = { sent: 0, skipped: 0, failed: 0 };
  const signoffStats = { sent: 0, skipped: 0, failed: 0 };

  for (const user of users ?? []) {
    const userId = user.id as string;
    const email = user.email as string;
    const clerkId = user.clerk_id as string;
    if (!email || !clerkId) continue;

    const { data: projects } = await withRetry(() =>
      db.from("projects").select("id, name, phase").eq("owner_clerk_id", clerkId).order("created_at", { ascending: true }).limit(20),
    );
    if (!projects?.length) continue;
    const projectIds = projects.map((p) => p.id as string);

    // --- Nudge: no packet reviews ---
    const alreadySentReview = await getDripCount(() =>
      db
        .from("drip_email_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("email_type", "nudge_no_reviews")
        .eq("status", "sent"),
    );
    if (alreadySentReview === 0) {
      const { count: reviewDecisions } = await withRetry(() =>
        db
          .from("approval_queue")
          .select("id", { count: "exact", head: true })
          .in("project_id", projectIds)
          .in("status", ["approved", "denied", "revised"]),
      );

      if ((reviewDecisions ?? 0) === 0) {
        const { data: pendingPackets } = await withRetry(() =>
          db
            .from("approval_queue")
            .select("project_id")
            .in("project_id", projectIds)
            .eq("status", "pending")
            .eq("action_type", "phase0_packet_review"),
        );

        if (pendingPackets?.length) {
          const oldestProjectId = pendingPackets[0].project_id as string;
          const oldestProject = projects.find((p) => p.id === oldestProjectId);
          const { subject, html } = nudgeNoReviewsEmail({
            pendingCount: pendingPackets.length,
            oldestProjectName: (oldestProject?.name as string) ?? "your project",
            baseUrl,
          });

          try {
            const result = await sendResendEmail({ to: email, subject, html });
            await recordDrip({
              userId,
              emailType: "nudge_no_reviews",
              projectId: null,
              digestWeek: null,
              toEmail: email,
              subject,
              resendMessageId: result.id,
              status: "sent",
              error: null,
            });
            reviewStats.sent += 1;
          } catch (err) {
            const detail = err instanceof Error ? err.message : "Send failed";
            await recordDrip({
              userId,
              emailType: "nudge_no_reviews",
              projectId: null,
              digestWeek: null,
              toEmail: email,
              subject,
              resendMessageId: null,
              status: "failed",
              error: detail,
            }).catch(() => {});
            reviewStats.failed += 1;
          }
        } else {
          reviewStats.skipped += 1;
        }
      } else {
        reviewStats.skipped += 1;
      }
    } else {
      reviewStats.skipped += 1;
    }

    // --- Nudge: no phase signoffs ---
    const alreadySentSignoff = await getDripCount(() =>
      db
        .from("drip_email_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("email_type", "nudge_no_signoffs")
        .eq("status", "sent"),
    );
    if (alreadySentSignoff === 0) {
      const allStillPhase0 = projects.every((p) => (p.phase as number) === 0);
      const { count: approvedAdvances } = await withRetry(() =>
        db
          .from("approval_queue")
          .select("id", { count: "exact", head: true })
          .in("project_id", projectIds)
          .eq("status", "approved")
          .in("action_type", [
            "phase0_packet_review",
            "phase1_validate_review",
            "phase2_distribute_review",
            "phase3_golive_review",
          ]),
      );

      if (allStillPhase0 && (approvedAdvances ?? 0) === 0) {
        const hasPendingAdvance = await withRetry(async () => {
          const { count } = await db
            .from("approval_queue")
            .select("id", { count: "exact", head: true })
            .in("project_id", projectIds)
            .eq("status", "pending")
            .in("action_type", [
              "phase0_packet_review",
              "phase1_validate_review",
              "phase2_distribute_review",
              "phase3_golive_review",
            ]);
          return (count ?? 0) > 0;
        });

        if (hasPendingAdvance) {
          const staleProject = projects[0];
          const { subject, html } = nudgeNoSignoffsEmail({
            projectName: (staleProject.name as string) ?? "your project",
            currentPhase: (staleProject.phase as number) ?? 0,
            baseUrl,
          });

          try {
            const result = await sendResendEmail({ to: email, subject, html });
            await recordDrip({
              userId,
              emailType: "nudge_no_signoffs",
              projectId: null,
              digestWeek: null,
              toEmail: email,
              subject,
              resendMessageId: result.id,
              status: "sent",
              error: null,
            });
            signoffStats.sent += 1;
          } catch (err) {
            const detail = err instanceof Error ? err.message : "Send failed";
            await recordDrip({
              userId,
              emailType: "nudge_no_signoffs",
              projectId: null,
              digestWeek: null,
              toEmail: email,
              subject,
              resendMessageId: null,
              status: "failed",
              error: detail,
            }).catch(() => {});
            signoffStats.failed += 1;
          }
        } else {
          signoffStats.skipped += 1;
        }
      } else {
        signoffStats.skipped += 1;
      }
    } else {
      signoffStats.skipped += 1;
    }
  }

  return { nudgeNoReviews: reviewStats, nudgeNoSignoffs: signoffStats };
}
