import { gasIntegrationPrompt } from "./gas-integration-prompt";
import { IntegrationPromptCard } from "./integration-prompt-card";

export function GasIntegrationPromptCard() {
  return (
    <IntegrationPromptCard
      title="Integrate Gas Station with your coding agent"
      description="Copy this prompt and paste it into your coding agent to adapt the complete Gas Station workflow to your existing project."
      prompt={gasIntegrationPrompt}
      accessibleLabel="Gas Station integration prompt"
    />
  );
}
