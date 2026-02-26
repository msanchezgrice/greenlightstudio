import { BulkImportWizard } from "@/components/bulk-import-wizard";
import { StudioNav } from "@/components/studio-nav";

export default function BulkImportPage() {
  return (
    <>
      <StudioNav active="board" pendingCount={0} />
      <BulkImportWizard />
    </>
  );
}
