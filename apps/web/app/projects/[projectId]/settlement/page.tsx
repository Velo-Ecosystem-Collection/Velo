import { AppShell } from "@/core/app-shell";
import { isMaintenanceEnabled } from "@/core/config/maintenance";
import { ProjectPageMaintenance } from "@/features/projects/project-page-maintenance";
import { ProjectSettlement } from "@/features/projects/project-settlement";
import { connection } from "next/server";

type ProjectSettlementPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectSettlementPage({ params }: ProjectSettlementPageProps) {
  await connection();

  const { projectId } = await params;
  const isSettlementMaintenanceEnabled = isMaintenanceEnabled(
    process.env.VELO_SETTLEMENT_MAINTENANCE,
  );

  return (
    <AppShell>
      {isSettlementMaintenanceEnabled ? (
        <ProjectPageMaintenance page="settlement" />
      ) : (
        <ProjectSettlement projectId={projectId} />
      )}
    </AppShell>
  );
}
