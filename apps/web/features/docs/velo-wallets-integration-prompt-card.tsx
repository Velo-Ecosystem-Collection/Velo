import { IntegrationPromptCard } from "./integration-prompt-card";
import { veloWalletsIntegrationPrompt } from "./velo-wallets-integration-prompt";

export function VeloWalletsIntegrationPromptCard() {
  return (
    <IntegrationPromptCard
      title="Integrate Velo Wallets with your coding agent"
      description="Copy this prompt and paste it into your coding agent to adapt the Velo Wallets setup and browser integration to your project."
      prompt={veloWalletsIntegrationPrompt}
      accessibleLabel="Velo Wallets integration prompt"
    />
  );
}
