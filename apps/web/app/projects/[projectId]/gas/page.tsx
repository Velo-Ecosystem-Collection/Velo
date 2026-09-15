import { AppShell } from "@/core/app-shell";
import { ProjectGas } from "@/features/projects/project-gas";

type ProjectGasPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectGasPage({ params }: ProjectGasPageProps) {
  const { projectId } = await params;

  return (
    <AppShell>
      <ProjectGas projectId={projectId} />
    </AppShell>
  );
}
