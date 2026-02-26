import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { StudioNav } from "@/components/studio-nav";
import { ChatPage } from "@/components/chat-page";
import { getPendingApprovalsByProject, getOwnedProjects } from "@/lib/studio";

export default async function ChatRoute() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((p) => p.id);
  const { total: pendingCount } = await getPendingApprovalsByProject(projectIds);

  return (
    <>
      <StudioNav active="chat" pendingCount={pendingCount} />
      <ChatPage />
    </>
  );
}
