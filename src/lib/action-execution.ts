import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { phase1PacketSchema, phase2PacketSchema, phase3PacketSchema } from "@/types/phase-packets";
import { createMetaCampaign, sendResendEmail, triggerGitHubRepositoryDispatch, triggerVercelDeployHook } from "@/lib/integrations";
import { generatePhase1LandingHtml } from "@/lib/agent";

type ApprovalRow = {
  id: string;
  project_id: string;
  action_type: string;
  payload: Record<string, unknown> | null;
};

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  repo_url: string | null;
  owner_clerk_id: string;
  runtime_mode: "shared" | "attached";
  phase: number;
  permissions: {
    repo_write?: boolean;
    deploy?: boolean;
    ads_enabled?: boolean;
    ads_budget_cap?: number;
    email_send?: boolean;
  } | null;
};

function parseDayOffset(day: string) {
  const match = day.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPhase1LandingHtml(project: ProjectRow, packet: ReturnType<typeof phase1PacketSchema.parse>) {
  const title = escapeHtml(packet.landing_page.headline);
  const subtitle = escapeHtml(packet.landing_page.subheadline);
  const cta = escapeHtml(packet.landing_page.primary_cta);
  const palette = packet.brand_kit.color_palette;
  const primary = palette[0];
  const secondary = palette[1];
  const background = palette[2];
  const sections = packet.landing_page.sections.map((section) => `<li>${escapeHtml(section)}</li>`).join("");
  const notes = packet.landing_page.launch_notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(project.name)} — Startup Machine Launch</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: ${background}; color: #E2E8F0; }
      .wrap { max-width: 880px; margin: 0 auto; padding: 64px 24px; }
      .badge { display: inline-block; font-size: 12px; padding: 6px 10px; border-radius: 999px; background: ${primary}22; color: ${primary}; margin-bottom: 16px; }
      h1 { font-size: 48px; line-height: 1.1; margin: 0 0 12px; color: #F8FAFC; }
      p.lead { color: #94A3B8; font-size: 18px; margin: 0 0 24px; max-width: 720px; }
      .cta { display: inline-block; background: ${primary}; color: #07141F; padding: 12px 22px; border-radius: 10px; font-weight: 700; text-decoration: none; }
      .grid { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .card { background: #0B1220; border: 1px solid #1E293B; border-radius: 12px; padding: 18px; }
      h2 { margin: 0 0 10px; font-size: 16px; color: #F8FAFC; }
      ul { margin: 0; padding-left: 18px; color: #94A3B8; line-height: 1.6; }
      .footer { margin-top: 28px; color: #64748B; font-size: 12px; }
      .accent { color: ${secondary}; }
      @media (max-width: 760px) { h1 { font-size: 36px; } .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main class="wrap">
      <div class="badge">▲ Startup Machine Shared Runtime</div>
      <h1>${title}</h1>
      <p class="lead">${subtitle}</p>
      <a class="cta" href="#">${cta}</a>
      <section class="grid">
        <article class="card">
          <h2>What’s Included</h2>
          <ul>${sections}</ul>
        </article>
        <article class="card">
          <h2>Launch Notes</h2>
          <ul>${notes}</ul>
        </article>
      </section>
      <p class="footer">Deployed by Startup Machine for <span class="accent">${escapeHtml(project.name)}</span>.</p>
    </main>
  </body>
</html>`;
}

async function createExecution(approval: ApprovalRow, status: "running" | "completed" | "failed", detail: string, providerResponse?: unknown) {
  const db = createServiceSupabase();
  await withRetry(() =>
    db.from("action_executions").insert({
      approval_id: approval.id,
      project_id: approval.project_id,
      action_type: approval.action_type,
      status,
      detail,
      provider_response: providerResponse ?? null,
    }),
  );
}

async function scheduleEmailJobs(input: {
  approval: ApprovalRow;
  project: ProjectRow;
  toEmail: string;
  sequence: Array<{ day: string; subject: string; goal: string }>;
}) {
  const db = createServiceSupabase();
  const now = Date.now();
  const rows = input.sequence.map((entry) => {
    const dayOffset = parseDayOffset(entry.day);
    const scheduled = new Date(now + dayOffset * 86400000).toISOString();
    const body = `<p>${escapeHtml(entry.goal)}</p><p>Project: ${escapeHtml(input.project.name)}</p>`;
    return {
      project_id: input.project.id,
      approval_id: input.approval.id,
      to_email: input.toEmail,
      subject: entry.subject,
      html_body: body,
      scheduled_for: scheduled,
      status: "queued",
    };
  });

  const { error } = await withRetry(() => db.from("email_jobs").insert(rows));
  if (error) throw new Error(error.message);
}

export async function processDueEmailJobs(limit = 50) {
  const db = createServiceSupabase();
  const now = new Date().toISOString();
  const { data: jobs, error } = await withRetry(() =>
    db
      .from("email_jobs")
      .select("id,project_id,to_email,subject,html_body")
      .eq("status", "queued")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(limit),
  );

  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    try {
      const result = await sendResendEmail({
        to: job.to_email as string,
        subject: job.subject as string,
        html: job.html_body as string,
      });
      await withRetry(() =>
        db
          .from("email_jobs")
          .update({
            status: "sent",
            provider_message_id: result.id,
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", job.id as string),
      );
      await withRetry(() =>
        log_task(job.project_id as string, "outreach_agent", "email_job_sent", "completed", `Sent ${job.subject as string}`),
      );
      sent += 1;
    } catch (jobError) {
      const detail = jobError instanceof Error ? jobError.message : "Email send failed";
      await withRetry(() =>
        db
          .from("email_jobs")
          .update({
            status: "failed",
            error: detail,
          })
          .eq("id", job.id as string),
      );
      await withRetry(() => log_task(job.project_id as string, "outreach_agent", "email_job_failed", "failed", detail));
      failed += 1;
    }
  }

  return { queued: (jobs ?? []).length, sent, failed };
}

export async function executeApprovedAction(input: {
  approval: ApprovalRow;
  project: ProjectRow;
  ownerEmail: string | null;
  appBaseUrl: string;
}) {
  const db = createServiceSupabase();
  await createExecution(input.approval, "running", "Execution started");

  try {
    const payload = input.approval.payload ?? {};

    if (input.approval.action_type === "deploy_landing_page") {
      const phasePacket = phase1PacketSchema.parse(payload.phase_packet ?? payload);
      let html = "";
      let agentAttempts = 0;
      const maxAgentAttempts = 2;
      let agentSuccess = false;
      let lastAgentError = "";

      while (agentAttempts < maxAgentAttempts && !agentSuccess) {
        agentAttempts++;
        try {
          await withRetry(() =>
            log_task(input.project.id, "design_agent", "phase1_design_agent_html", "running", `Design Agent generating landing page (attempt ${agentAttempts})`),
          );
          html = await generatePhase1LandingHtml({
            project_name: input.project.name,
            domain: input.project.domain,
            idea_description: (payload.idea_description as string) ?? input.project.name,
            brand_kit: phasePacket.brand_kit,
            landing_page: phasePacket.landing_page,
            waitlist_fields: phasePacket.waitlist.form_fields,
          });
          agentSuccess = true;
          await withRetry(() =>
            log_task(input.project.id, "design_agent", "phase1_design_agent_html", "completed", "Design Agent generated custom landing page"),
          );
        } catch (designError) {
          lastAgentError = designError instanceof Error ? designError.message : "Unknown design agent error";
        }
      }

      if (!agentSuccess) {
        await withRetry(() =>
          log_task(input.project.id, "design_agent", "phase1_design_agent_fallback", "completed", `Design Agent failed after ${agentAttempts} attempts, using template: ${lastAgentError.slice(0, 200)}`),
        );
        html = renderPhase1LandingHtml(input.project, phasePacket);
      }
      const deploymentPath = `${input.project.id}/deployments/landing-${Date.now()}.html`;
      const upload = await withRetry(() =>
        db.storage.from("project-assets").upload(deploymentPath, new TextEncoder().encode(html), {
          contentType: "text/html; charset=utf-8",
          upsert: true,
        }),
      );
      if (upload.error) {
        throw new Error(upload.error.message);
      }

      const { data: asset, error: assetError } = await withRetry(() =>
        db
          .from("project_assets")
          .insert({
            project_id: input.project.id,
            phase: 1,
            kind: "landing_html",
            storage_bucket: "project-assets",
            storage_path: deploymentPath,
            filename: "index.html",
            mime_type: "text/html",
            size_bytes: Buffer.byteLength(html, "utf8"),
            status: "uploaded",
            metadata: { action_type: input.approval.action_type },
            created_by: input.project.owner_clerk_id,
          })
          .select("id")
          .single(),
      );
      if (assetError) throw new Error(assetError.message);

      const liveUrl = `${input.appBaseUrl}/launch/${input.project.id}`;
      await withRetry(() =>
        db
          .from("project_deployments")
          .upsert(
            {
              project_id: input.project.id,
              phase: 1,
              status: "ready",
              html_content: html,
              metadata: { asset_id: asset.id, storage_path: deploymentPath },
              deployed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "project_id" },
          ),
      );
      await withRetry(() =>
        db
          .from("projects")
          .update({ deploy_status: "ready", live_url: liveUrl, updated_at: new Date().toISOString() })
          .eq("id", input.project.id),
      );

      if (process.env.VERCEL_DEPLOY_HOOK_URL) {
        await triggerVercelDeployHook({ projectId: input.project.id, action: "shared_runtime_deploy", liveUrl });
      }

      await withRetry(() => log_task(input.project.id, "design_agent", "phase1_deploy_live", "completed", liveUrl));
      await withRetry(() =>
        db
          .from("phase_packets")
          .update({
            deliverables: [
              {
                kind: "landing_html",
                label: "Landing Page",
                url: liveUrl,
                storage_path: deploymentPath,
                status: "stored",
                generated_at: new Date().toISOString(),
              },
            ],
          })
          .eq("project_id", input.project.id)
          .eq("phase", 1),
      );
      await createExecution(input.approval, "completed", `Landing deployed: ${liveUrl}`, { live_url: liveUrl });
      return { detail: `Landing deployed: ${liveUrl}` };
    }

    if (input.approval.action_type === "send_welcome_email_sequence") {
      if (!input.ownerEmail) throw new Error("Owner email not found for email sequence send.");
      const phasePacket = phase1PacketSchema.parse(payload.phase_packet ?? payload);
      await scheduleEmailJobs({
        approval: input.approval,
        project: input.project,
        toEmail: input.ownerEmail,
        sequence: phasePacket.email_sequence.emails,
      });
      const sendResult = await processDueEmailJobs(25);
      await createExecution(input.approval, "completed", "Email sequence queued and due jobs processed", sendResult);
      return { detail: `Email queued. sent=${sendResult.sent} failed=${sendResult.failed}` };
    }

    if (input.approval.action_type === "send_phase2_lifecycle_email") {
      if (!input.ownerEmail) throw new Error("Owner email not found for lifecycle email send.");
      const phasePacket = phase2PacketSchema.parse(payload.phase_packet ?? payload);
      await scheduleEmailJobs({
        approval: input.approval,
        project: input.project,
        toEmail: input.ownerEmail,
        sequence: [
          {
            day: "Day 0",
            subject: `${input.project.name}: Lifecycle Journey Activated`,
            goal: `Journeys: ${phasePacket.lifecycle_email.journeys.join(", ")}. Window: ${phasePacket.lifecycle_email.send_window}`,
          },
        ],
      });
      const sendResult = await processDueEmailJobs(10);
      await createExecution(input.approval, "completed", "Lifecycle email job processed", sendResult);
      return { detail: `Lifecycle email sent=${sendResult.sent} failed=${sendResult.failed}` };
    }

    if (input.approval.action_type === "activate_meta_ads_campaign") {
      const phasePacket = phase2PacketSchema.parse(payload.phase_packet ?? payload);
      const campaign = await createMetaCampaign({
        name: `${input.project.name} Phase 2 Test`,
        dailyBudgetUsd: Math.max(0, phasePacket.paid_acquisition.budget_cap_per_day),
      });
      await withRetry(() =>
        log_task(
          input.project.id,
          "growth_agent",
          "phase2_ads_campaign_created",
          "completed",
          `Meta campaign ${campaign.campaignId} created in PAUSED status`,
        ),
      );
      await createExecution(input.approval, "completed", "Meta campaign created", campaign);
      return { detail: `Meta campaign created: ${campaign.campaignId}` };
    }

    if (input.approval.action_type === "trigger_phase3_repo_workflow") {
      if (!input.project.repo_url) throw new Error("Repository URL missing for Phase 3 repo workflow trigger.");
      const phasePacket = phase3PacketSchema.parse(payload.phase_packet ?? payload);
      const dispatch = await triggerGitHubRepositoryDispatch({
        repoUrl: input.project.repo_url,
        eventType: "greenlight_phase3_launch",
        clientPayload: {
          project_id: input.project.id,
          project_name: input.project.name,
          phase: 3,
          merge_policy: phasePacket.merge_policy,
          checklist: phasePacket.launch_checklist,
        },
      });
      await withRetry(() =>
        log_task(input.project.id, "engineering_agent", "phase3_repo_workflow_triggered", "completed", `${dispatch.owner}/${dispatch.repo}`),
      );
      await createExecution(input.approval, "completed", "GitHub repository_dispatch triggered", dispatch);
      return { detail: `GitHub dispatch triggered for ${dispatch.owner}/${dispatch.repo}` };
    }

    if (input.approval.action_type === "trigger_phase3_deploy") {
      const deploy = await triggerVercelDeployHook({
        projectId: input.project.id,
        action: "phase3_deploy",
        phase: 3,
      });
      await withRetry(() => log_task(input.project.id, "engineering_agent", "phase3_deploy_triggered", "completed", "Vercel deploy hook called"));
      await createExecution(input.approval, "completed", "Vercel deploy hook triggered", deploy);
      return { detail: "Vercel deploy hook triggered." };
    }

    throw new Error(`Unsupported executable action: ${input.approval.action_type}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Action execution failed";
    await createExecution(input.approval, "failed", detail);
    await withRetry(() => log_task(input.project.id, "ceo_agent", "approval_execution_failed", "failed", detail));
    throw new Error(detail);
  }
}
