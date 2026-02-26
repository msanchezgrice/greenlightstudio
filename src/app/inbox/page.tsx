import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { InboxView } from "@/components/inbox-view";
import { get_approval_queue } from "@/lib/supabase-mcp";

type Project = { id: string; name: string; phase: number };

type QueueRow = {
  id: string;
  project_id: string;
  phase: number;
  title: string;
  description: string;
  risk: "high" | "medium" | "low";
  action_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "revised";
  version: number;
  created_at: string;
  decided_at: string | null;
};

export default async function InboxPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const db = createServiceSupabase();
  const { data: projectsData } = await db.from("projects").select("id,name,phase").eq("owner_clerk_id", userId);
  const projects = (projectsData ?? []) as Project[];

  if (!projects.length) {
    return (
      <main className="page empty-page">
        <h1 className="page-title">📥 Approval Inbox</h1>
        <p className="meta-line">No projects found. Start with onboarding first.</p>
      </main>
    );
  }

  const projectIds = projects.map((project) => project.id);
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const rowsData = await get_approval_queue(projectIds);

  const rows = ((rowsData ?? []) as QueueRow[]).map((row) => ({
    ...row,
    project_name: projectMap.get(row.project_id)?.name ?? row.project_id,
  }));

  return <InboxView initialItems={rows} />;
}
