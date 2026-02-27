import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { StudioNav } from "@/components/studio-nav";
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
      <>
        <StudioNav active="inbox" pendingCount={0} />
        <main className="page studio-page">
          <section className="zero-state">
            <div className="zero-state-icon">📥</div>
            <h2 className="zero-state-title">Your Inbox is Empty</h2>
            <p className="zero-state-desc">
              When your AI agents need approval for high-impact actions, they will appear here.
              Create a project to get started.
            </p>
            <div className="zero-state-actions">
              <Link href="/onboarding?new=1" className="btn btn-approve" style={{ padding: "10px 24px", fontSize: 14 }}>
                Create a Project
              </Link>
              <Link href="/board" className="btn btn-details" style={{ padding: "10px 24px", fontSize: 14 }}>
                Go to Board
              </Link>
            </div>
          </section>
        </main>
      </>
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
