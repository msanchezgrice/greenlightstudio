import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { createServiceSupabase } from "@/lib/supabase";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { withRetry } from "@/lib/retry";

function boolStatus(value: boolean) {
  return value ? "Configured" : "Missing";
}

function boolClass(value: boolean) {
  return value ? "good" : "bad";
}

type ProjectPermissions = {
  repo_write?: boolean;
  deploy?: boolean;
  email_send?: boolean;
  ads_enabled?: boolean;
  ads_budget_cap?: number;
};

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const db = createServiceSupabase();
  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const { total: pendingCount } = await getPendingApprovalsByProject(projectIds);

  const recentProject = projects[0] ?? null;
  const permissions = (recentProject?.permissions as ProjectPermissions | null) ?? null;

  const userQuery = await withRetry(() => db.from("users").select("email,created_at").eq("clerk_id", userId).maybeSingle());
  const userEmail = userQuery.data?.email ?? null;

  const integrationStates = [
    {
      name: "Clerk",
      configured: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY),
      detail: "Authentication and sessions",
    },
    {
      name: "Supabase",
      configured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      detail: "Database and storage",
    },
    {
      name: "Anthropic",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      detail: "Claude Agent SDK execution",
    },
    {
      name: "Night Shift Secret",
      configured: Boolean(process.env.NIGHT_SHIFT_SECRET),
      detail: "Protected night-shift endpoint auth",
    },
    {
      name: "Cron Secret",
      configured: Boolean(process.env.CRON_SECRET),
      detail: "Vercel cron authorization",
    },
    {
      name: "Vercel Deploy Hook",
      configured: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL),
      detail: "Shared-runtime + Phase 3 deploy trigger",
    },
    {
      name: "Resend",
      configured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      detail: "Email sends for Phase 1/2 actions",
    },
    {
      name: "Meta Ads",
      configured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
      detail: "Phase 2 paid campaign provisioning",
    },
    {
      name: "GitHub Dispatch",
      configured: Boolean(process.env.GITHUB_TOKEN),
      detail: "Phase 3 repository workflow trigger",
    },
  ];

  return (
    <>
      <StudioNav active="settings" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <h1 className="page-title">Settings</h1>
        </div>

        <section className="studio-card">
          <h2>Account</h2>
          <div className="project-metrics">
            <div>
              <div className="metric-label">Clerk ID</div>
              <div className="metric-value">{userId}</div>
            </div>
            <div>
              <div className="metric-label">Email</div>
              <div className="metric-value">{userEmail ?? "Not synced"}</div>
            </div>
            <div>
              <div className="metric-label">Projects</div>
              <div className="metric-value">{projects.length}</div>
            </div>
            <div>
              <div className="metric-label">Account Created</div>
              <div className="metric-value">{userQuery.data?.created_at ? new Date(userQuery.data.created_at).toLocaleString() : "Unknown"}</div>
            </div>
          </div>
        </section>

        <section className="studio-card">
          <h2>Integrations</h2>
          <div className="table-shell">
            <table className="studio-table compact">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {integrationStates.map((integration) => (
                  <tr key={integration.name}>
                    <td>{integration.name}</td>
                    <td className={boolClass(integration.configured)}>{boolStatus(integration.configured)}</td>
                    <td>{integration.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="studio-card">
          <h2>Latest Project Defaults</h2>
          {!recentProject ? (
            <p className="meta-line">No projects yet. Defaults will appear after first onboarding run.</p>
          ) : (
            <div className="project-metrics">
              <div>
                <div className="metric-label">Project</div>
                <div className="metric-value">{recentProject.name}</div>
              </div>
              <div>
                <div className="metric-label">Runtime Mode</div>
                <div className="metric-value">{recentProject.runtime_mode === "attached" ? "Attached" : "Shared"}</div>
              </div>
              <div>
                <div className="metric-label">Night Shift</div>
                <div className={`metric-value ${recentProject.night_shift ? "good" : "tone-muted"}`}>
                  {recentProject.night_shift ? "Enabled" : "Disabled"}
                </div>
              </div>
              <div>
                <div className="metric-label">Repo Write</div>
                <div className={`metric-value ${permissions?.repo_write ? "good" : "tone-muted"}`}>{permissions?.repo_write ? "On" : "Off"}</div>
              </div>
              <div>
                <div className="metric-label">Deploy</div>
                <div className={`metric-value ${permissions?.deploy ? "good" : "tone-muted"}`}>{permissions?.deploy ? "On" : "Off"}</div>
              </div>
              <div>
                <div className="metric-label">Email</div>
                <div className={`metric-value ${permissions?.email_send ? "good" : "tone-muted"}`}>{permissions?.email_send ? "On" : "Off"}</div>
              </div>
              <div>
                <div className="metric-label">Ads</div>
                <div className="metric-value">
                  {permissions?.ads_enabled ? `$${Number(permissions.ads_budget_cap ?? 0)}/day` : "$0/day"}
                </div>
              </div>
              <div>
                <div className="metric-label">Focus Areas</div>
                <div className="metric-value">{recentProject.focus_areas?.length ? recentProject.focus_areas.join(", ") : "None"}</div>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
