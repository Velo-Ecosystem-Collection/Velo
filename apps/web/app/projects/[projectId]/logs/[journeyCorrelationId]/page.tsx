import { AppShell } from "@/core/app-shell";
import { ProjectPlaygroundLog } from "@/features/playground/project-log";

type ProjectLogPageProps = {
  params: Promise<{ projectId: string; journeyCorrelationId: string }>;
};

export default async function ProjectLogPage({ params }: ProjectLogPageProps) {
  const { projectId, journeyCorrelationId } = await params;

  return (
    <AppShell>
      <ProjectPlaygroundLog
        projectId={projectId}
        journeyCorrelationId={decodeURIComponent(journeyCorrelationId)}
      />
    </AppShell>
  );
}
