import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { getLatestPacketsByProject, getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";

function phaseLabel(phase: number) {
  if (phase <= 0) return "Phase 0";
  if (phase === 1) return "Phase 1";
  if (phase === 2) return "Phase 2";
  if (phase === 3) return "Phase 3";
  return "Launched";
}

function phaseRoute(phase: number) {
  return Math.min(3, Math.max(0, phase));
}

export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const [{ total: pendingCount, byProject: pendingByProject }, latestPackets] = await Promise.all([
    getPendingApprovalsByProject(projectIds),
    getLatestPacketsByProject(projectIds),
  ]);

  return (
    <>
      <StudioNav active="projects" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <h1 className="page-title">Projects</h1>
          <Link href="/onboarding" className="btn btn-approve">
            New Project
          </Link>
        </div>

        {!projects.length ? (
          <section className="studio-card">
            <h2>No projects yet</h2>
            <p className="meta-line">Create your first project in onboarding to start the phase pipeline.</p>
          </section>
        ) : (
          <section className="studio-card">
            <div className="table-shell">
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Phase</th>
                    <th>Runtime</th>
                    <th>Pending</th>
                    <th>Confidence</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => {
                    const packet = latestPackets.get(project.id);
                    const pending = pendingByProject.get(project.id) ?? 0;

                    return (
                      <tr key={project.id}>
                        <td>
                          <div className="table-main">{project.name}</div>
                          <div className="table-sub">{project.domain ?? "No domain"}</div>
                        </td>
                        <td>{phaseLabel(project.phase)}</td>
                        <td>{project.runtime_mode === "attached" ? "Attached" : "Shared"}</td>
                        <td className={pending > 0 ? "warn" : "good"}>{pending}</td>
                        <td>{packet ? `${packet.confidence}/100` : "--"}</td>
                        <td>{new Date(project.updated_at).toLocaleString()}</td>
                        <td>
                          <div className="table-actions">
                            <Link href={`/projects/${project.id}`} className="btn btn-details">
                              Open
                            </Link>
                            <Link href={`/projects/${project.id}/phases`} className="btn btn-details">
                              Phases
                            </Link>
                            <Link href={`/projects/${project.id}/phases/${phaseRoute(project.phase)}`} className="btn btn-preview">
                              Active Phase
                            </Link>
                            <Link href={`/projects/${project.id}/packet`} className="btn btn-preview">
                              Packet
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
