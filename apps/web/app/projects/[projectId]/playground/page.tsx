import { AppShell } from "@/core/app-shell";
import { PlaygroundClient } from "@/features/playground/playground-client";

type ProjectPlaygroundPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ network?: string; contractId?: string; share?: string }>;
};

export default async function ProjectPlaygroundPage({
  params,
  searchParams,
}: ProjectPlaygroundPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);

  return (
    <AppShell>
      <PlaygroundClient
        projectId={projectId}
        initialNetwork={query.network === "mainnet" ? "mainnet" : "testnet"}
        initialContractId={query.contractId ?? ""}
        shareToken={query.share}
      />
    </AppShell>
  );
}
