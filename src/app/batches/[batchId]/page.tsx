import { BatchProgress } from "@/components/batch-progress";
import { StudioNav } from "@/components/studio-nav";

export default async function BatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return (
    <>
      <StudioNav active="board" pendingCount={0} />
      <main className="page studio-page">
        <BatchProgress batchId={batchId} />
      </main>
    </>
  );
}
