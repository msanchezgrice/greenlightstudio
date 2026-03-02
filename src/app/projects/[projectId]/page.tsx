import { redirect } from "next/navigation";

export default async function ProjectEntryRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/phases`);
}
