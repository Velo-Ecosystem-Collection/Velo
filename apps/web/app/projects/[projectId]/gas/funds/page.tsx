import { AppShell } from "@/core/app-shell";
import { ProjectGasFunds } from "@/features/projects/project-gas-funds";

type ProjectGasFundsPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectGasFundsPage({ params }: ProjectGasFundsPageProps) {
  const { projectId } = await params;

  return (
    <AppShell>
      <ProjectGasFunds projectId={projectId} />
    </AppShell>
  );
}
