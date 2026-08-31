import { AppShell } from "@/core/app-shell";
import { SharedPlaygroundRequest } from "@/features/playground/shared-playground-request";

export default async function SharedPlaygroundPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AppShell>
      <SharedPlaygroundRequest token={token} />
    </AppShell>
  );
}
