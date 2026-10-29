import { AppShell } from "@/core/app-shell";
import { isMaintenanceEnabled } from "@/core/config/maintenance";
import { ProjectPageMaintenance } from "@/features/projects/project-page-maintenance";
import { ProjectPayments } from "@/features/projects/project-payments";
import { connection } from "next/server";

type ProjectPaymentsPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectPaymentsPage({ params }: ProjectPaymentsPageProps) {
  await connection();

  const { projectId } = await params;
  const isPaymentsMaintenanceEnabled = isMaintenanceEnabled(process.env.VELO_PAYMENTS_MAINTENANCE);

  return (
    <AppShell>
      {isPaymentsMaintenanceEnabled ? (
        <ProjectPageMaintenance page="payments" />
      ) : (
        <ProjectPayments projectId={projectId} />
      )}
    </AppShell>
  );
}
