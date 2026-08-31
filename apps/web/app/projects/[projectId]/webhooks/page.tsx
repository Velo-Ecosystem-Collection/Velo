import { AppShell } from "@/core/app-shell";
import { ProjectWebhooks } from "@/features/projects/project-webhooks";

type ProjectWebhooksPageProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    sourceExecutionId?: string;
    eventIndex?: string;
  }>;
};

export default async function ProjectWebhooksPage({
  params,
  searchParams,
}: ProjectWebhooksPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const eventIndex = Number(query.eventIndex);

  return (
    <AppShell>
      <ProjectWebhooks
        projectId={projectId}
        sourceExecutionId={query.sourceExecutionId}
        eventIndex={Number.isSafeInteger(eventIndex) && eventIndex >= 0 ? eventIndex : undefined}
      />
    </AppShell>
  );
}
